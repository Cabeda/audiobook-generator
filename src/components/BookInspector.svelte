<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Book, Chapter } from '../lib/types/book'
  import ChapterItem from './ChapterItem.svelte'
  import { toastStore } from '../stores/toastStore'

  let {
    book,
    generatedAudioMap = new Map(),
    selectedVoice,
    selectedQuantization,
    selectedDevice = 'auto',
    selectedModel = 'kokoro',
    chapterStatus,
    chapterErrors,
  } = $props<{
    book: Book
    generatedAudioMap?: Map<string, { url: string; blob: Blob }>
    selectedVoice: string
    selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    selectedDevice?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper' | 'web_speech'
    chapterStatus?: Map<string, 'pending' | 'processing' | 'done' | 'error'>
    chapterErrors?: Map<string, string>
  }>()

  const dispatch = createEventDispatcher()

  // Map of chapter id -> selected
  let selected = $state(new Map<string, boolean>())

  // initialize selections when book changes
  $effect(() => {
    if (book) {
      const newMap = new Map<string, boolean>()
      for (const ch of book.chapters) {
        newMap.set(ch.id, true)
      }
      selected = newMap
    }
  })

  function toggleChapter(id: string) {
    selected.set(id, !selected.get(id))
    // Ensure reactivity across Svelte versions: reassign the Map
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
    const selectedChapters: Chapter[] = book.chapters.filter((ch: Chapter) => selected.get(ch.id))
    if (selectedChapters.length === 0) {
      toastStore.warning('No chapters selected')
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

  function openReader(ch: Chapter) {
    dispatch('readchapter', { chapter: ch })
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

  <div class="controls-bar">
    <div class="left-controls">
      <button class="text-btn" onclick={selectAll}>Select all</button>
      <span class="separator">•</span>
      <button class="text-btn" onclick={deselectAll}>Deselect all</button>
    </div>

    <div class="right-controls">
      <span class="selection-count">
        <strong>{Array.from(selected.values()).filter(Boolean).length}</strong> selected
      </span>
      <button class="primary-btn" onclick={exportSelected}> Export Selected </button>
    </div>
  </div>

  <div class="chapter-list" role="list">
    {#each book.chapters as ch}
      <ChapterItem
        chapter={ch}
        selected={selected.get(ch.id)}
        audioData={generatedAudioMap.get(ch.id)}
        status={chapterStatus?.get(ch.id)}
        error={chapterErrors?.get(ch.id)}
        onToggle={toggleChapter}
        onRead={openReader}
        onDownloadWav={(id) => dispatch('downloadwav', { id })}
        onDownloadMp3={(id) => dispatch('downloadmp3', { id })}
        onRetry={(id) => dispatch('retry', { id })}
      />
    {/each}
  </div>
</div>

<style>
  .cover {
    max-width: 120px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .book-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .book-meta h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--text-color);
  }

  .format-badge {
    display: inline-block;
    padding: 4px 8px;
    background: var(--selected-bg);
    letter-spacing: 0.5px;
  }

  /* Controls Bar */
  .controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .text-btn:hover {
    background: var(--bg-color);
    color: var(--text-color);
  }

  .separator {
    color: var(--border-color);
  }

  .primary-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .primary-btn:hover {
    background: var(--primary-hover);
  }

  .selection-count {
    font-size: 0.9rem;
    color: var(--secondary-text);
  }

  /* Chapter List */
  .chapter-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* Mobile Responsive */
  @media (max-width: 640px) {
    .controls-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }

    .left-controls,
    .right-controls {
      justify-content: space-between;
    }
  }
</style>
