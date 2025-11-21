<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Book, Chapter } from '../lib/types/book'
  import { getTTSWorker } from '../lib/ttsWorkerManager'
  import TextReader from './TextReader.svelte'

  export let book: Book
  export let selectedVoice: string
  export let selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  export let selectedDevice: 'auto' | 'wasm' | 'webgpu' | 'cpu' = 'auto'

  const dispatch = createEventDispatcher()

  // Map of chapter id -> selected
  let selected = new Map<string, boolean>()

  // Preview playback state
  let playingChapterId: string | null = null
  let loadingChapterId: string | null = null
  let previewAudio: HTMLAudioElement | null = null

  // Cache for preview URLs: key -> blob URL
  // Key format: `${chapterId}:${voice}:${quantization}`
  let previewCache = new Map<string, string>()

  // Track which chapter reader is open
  let openReaderId: string | null = null

  // initialize selections when book changes
  $: if (book) {
    const newMap = new Map<string, boolean>()
    for (const ch of book.chapters) {
      // default: selected
      newMap.set(ch.id, selected.get(ch.id) ?? true)
    }
    selected = newMap

    // Clear cache and revoke URLs when book changes
    for (const url of previewCache.values()) {
      URL.revokeObjectURL(url)
    }
    previewCache.clear()
  }

  function toggleChapter(id: string) {
    selected.set(id, !selected.get(id))
    // trigger reactivity
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function selectAll() {
    for (const k of selected.keys()) selected.set(k, true)
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function deselectAll() {
    for (const k of selected.keys()) selected.set(k, false)
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function exportSelected() {
    const selectedChapters: Chapter[] = book.chapters.filter((ch) => selected.get(ch.id))
    if (selectedChapters.length === 0) {
      alert('No chapters selected')
      return
    }
    const contents = selectedChapters
      .map((c, i) => `=== ${c.title} ===\n\n${c.content}\n\n`)
      .join('\n')
    const blob = new Blob([contents], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeTitle = (book.title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    a.download = `${safeTitle}_selected.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    dispatch('export', { count: selectedChapters.length })
  }

  function copyChapterContent(ch: Chapter) {
    navigator.clipboard?.writeText(ch.content).catch(() => alert('Clipboard not available'))
  }

  function getPreviewText(content: string, maxChars = 500): string {
    // Split by paragraphs
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim())

    // Take first 2 paragraphs
    let preview = paragraphs.slice(0, 2).join('\n\n')

    // Limit to maxChars
    if (preview.length > maxChars) {
      preview = preview.slice(0, maxChars).trim() + '...'
    }

    return preview || content.slice(0, maxChars)
  }

  function stopPreview() {
    if (previewAudio) {
      previewAudio.pause()
      // Don't revoke URL here as we want to cache it
      previewAudio = null
    }
    playingChapterId = null
    loadingChapterId = null
  }

  async function previewChapter(ch: Chapter) {
    // If this chapter is currently playing, stop it
    if (playingChapterId === ch.id) {
      stopPreview()
      return
    }

    try {
      // Stop any currently playing preview
      stopPreview()

      // Check cache first
      const cacheKey = `${ch.id}:${selectedVoice}:${selectedQuantization}`
      let url = previewCache.get(cacheKey)

      if (!url) {
        // Set loading state only if we need to generate
        loadingChapterId = ch.id

        // Get preview text (first 500 chars or 2 paragraphs)
        const previewText = getPreviewText(ch.content)

        // Generate TTS preview using selected options
        const worker = getTTSWorker()
        const blob = await worker.generateVoice({
          text: previewText,
          modelType: 'kokoro',
          voice: selectedVoice,
          dtype: selectedQuantization,
        })

        // Clear loading state
        loadingChapterId = null

        // Create URL and cache it
        url = URL.createObjectURL(blob)
        previewCache.set(cacheKey, url)
      }

      // Create and play audio
      if (url) {
        previewAudio = new Audio(url)
        playingChapterId = ch.id

        // Clear playing state when audio ends
        previewAudio.onended = () => {
          playingChapterId = null
          previewAudio = null
        }

        // Handle errors
        previewAudio.onerror = () => {
          playingChapterId = null
          loadingChapterId = null
          alert('Failed to play preview audio')
        }

        await previewAudio.play()
      }
    } catch (err) {
      playingChapterId = null
      loadingChapterId = null
      console.error('Preview generation error:', err)
      alert('Failed to generate preview: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  function openReader(ch: Chapter) {
    // Stop any preview that might be playing
    stopPreview()
    openReaderId = ch.id
  }

  function closeReader() {
    openReaderId = null
  }
</script>

<div>
  <div class="book-meta">
    <h2>{book.title}</h2>
    {#if book.format}
      <span class="format-badge">{book.format.toUpperCase()}</span>
    {/if}
  </div>
  <p><strong>Author:</strong> {book.author}</p>
  {#if book.cover}
    <img class="cover" src={book.cover} alt="cover" />
  {/if}

  <div class="controls">
    <button on:click={selectAll}>Select all</button>
    <button on:click={deselectAll}>Deselect all</button>
    <button on:click={exportSelected}>Export selected</button>
    <div style="margin-left:auto">
      Selected: {Array.from(selected.values()).filter(Boolean).length} / {book.chapters.length}
    </div>
  </div>

  <h3>Chapters</h3>
  <div>
    {#each book.chapters as ch}
      <div class="chapter">
        <div style="width:28px">
          <input
            type="checkbox"
            checked={selected.get(ch.id)}
            on:change={() => toggleChapter(ch.id)}
          />
        </div>
        <div style="flex:1">
          <div class="chapter-title">{ch.title}</div>
          <div style="font-size:0.9em;color:#444">
            {ch.content.slice(0, 300)}{ch.content.length > 300 ? '…' : ''}
          </div>
        </div>
        <div style="width:180px; text-align:right; display:flex; gap:4px; justify-content:flex-end">
          <button
            class="preview-button"
            class:loading={loadingChapterId === ch.id}
            class:playing={playingChapterId === ch.id}
            on:click={() => previewChapter(ch)}
            disabled={loadingChapterId === ch.id}
            title={playingChapterId === ch.id
              ? 'Stop preview'
              : 'Preview with current TTS settings'}
          >
            {#if loadingChapterId === ch.id}
              ⏳
            {:else if playingChapterId === ch.id}
              ⏹️
            {:else}
              🔊
            {/if}
          </button>
          <button on:click={() => openReader(ch)} title="Read full text with TTS">📖 Read</button>
          <button on:click={() => copyChapterContent(ch)}>Copy</button>
        </div>
      </div>
    {/each}
  </div>

  <!-- TextReader modal -->
  {#if openReaderId}
    {@const readerChapter = book.chapters.find((ch) => ch.id === openReaderId)}
    {#if readerChapter}
      <TextReader
        chapter={readerChapter}
        voice={selectedVoice}
        quantization={selectedQuantization}
        device={selectedDevice}
        onClose={closeReader}
      />
    {/if}
  {/if}
</div>

<style>
  .cover {
    max-width: 200px;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }
  .chapter {
    padding: 8px;
    border-bottom: 1px solid #eee;
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .chapter-title {
    font-weight: 600;
  }
  .controls {
    margin: 12px 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .book-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .book-meta h2 {
    margin: 0;
  }
  .format-badge {
    display: inline-block;
    padding: 4px 10px;
    background: #e3f2fd;
    color: #1976d2;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }

  /* Preview button animations */
  .preview-button {
    transition: all 0.2s ease;
    position: relative;
  }

  .preview-button:hover:not(:disabled) {
    transform: scale(1.1);
    filter: brightness(1.1);
  }

  .preview-button:active:not(:disabled) {
    transform: scale(0.95);
  }

  .preview-button.loading {
    animation: pulse 1.5s ease-in-out infinite;
  }

  .preview-button.playing {
    animation: playing-pulse 2s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.4);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.05);
    }
  }

  @keyframes playing-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(25, 118, 210, 0.4);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(25, 118, 210, 0);
    }
  }
</style>
