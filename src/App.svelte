<script lang="ts">
  import UploadArea from './components/UploadArea.svelte'
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import type { Book, Chapter } from './lib/types/book'

  let book: Book | null = null

  // Map of chapter id -> boolean (selected)
  let selectedMap: Map<string, boolean> = new Map()

  // generated audio map: chapter id -> { url, blob }
  let generated = new Map<string, { url: string; blob: Blob }>()

  // TTS options (lifted from GeneratePanel for sharing with BookInspector)
  let selectedVoice: string = 'af_heart'
  let selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8'

  // Load TTS options from localStorage on mount
  import { onMount } from 'svelte'
  const QUANT_KEY = 'audiobook_quantization'
  const VOICE_KEY = 'audiobook_voice'

  onMount(() => {
    try {
      const savedVoice = localStorage.getItem(VOICE_KEY)
      if (savedVoice) selectedVoice = savedVoice

      const savedQuant = localStorage.getItem(QUANT_KEY)
      if (savedQuant) selectedQuantization = savedQuant as typeof selectedQuantization
    } catch (e) {
      // ignore (e.g., SSR or privacy mode)
    }
  })

  async function onFileSelected(e: CustomEvent) {
    const file: File = e.detail.file
    const providedBook = e.detail.book
    if (providedBook) {
      book = providedBook
      // initialize selected map
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
      return
    }

    try {
      const { parseEpubFile } = await import('./lib/epubParser')
      book = await parseEpubFile(file)
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
    } catch (err) {
      console.error('Failed to parse EPUB:', err)
      alert('Failed to parse EPUB. See console for details.')
    }
  }

  function onSelectionChanged(e: CustomEvent) {
    const entries: [string, boolean][] = e.detail.selected || []
    selectedMap = new Map(entries)
  }

  function onGenerated(e: CustomEvent) {
    const { id, blob } = e.detail
    const url = URL.createObjectURL(blob)
    generated.set(id, { url, blob })
    // trigger reactivity
    generated = new Map(generated)
  }

  function downloadBlob(id: string) {
    const rec = generated.get(id)
    if (!rec) return
    const a = document.createElement('a')
    a.href = rec.url
    a.download = `${id}.wav`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function downloadBlobAsMp3(id: string) {
    const rec = generated.get(id)
    if (!rec) return

    try {
      const { convertWavToMp3, downloadAudioFile } = await import('./lib/audioConcat')
      const mp3Blob = await convertWavToMp3(rec.blob, 192)
      downloadAudioFile(mp3Blob, `${id}.mp3`)
    } catch (err) {
      console.error('Failed to convert to MP3:', err)
      alert('Failed to convert to MP3. See console for details.')
    }
  }

  // Get chapter title from ID
  function getChapterTitle(id: string): string {
    if (!book) return id
    const chapter = book.chapters.find((c) => c.id === id)
    return chapter?.title || id
  }

  // Handle TTS option changes from GeneratePanel
  function onVoiceChanged(e: CustomEvent) {
    selectedVoice = e.detail.voice
    try {
      localStorage.setItem(VOICE_KEY, selectedVoice)
    } catch (e) {
      // ignore
    }
  }

  function onQuantizationChanged(e: CustomEvent) {
    selectedQuantization = e.detail.quantization
    try {
      localStorage.setItem(QUANT_KEY, selectedQuantization)
    } catch (e) {
      // ignore
    }
  }
</script>

<main>
  <h1>Audiobook Generator (Web)</h1>
  <UploadArea on:fileselected={onFileSelected} />

  {#if book}
    <GeneratePanel
      {book}
      {selectedMap}
      {selectedVoice}
      {selectedQuantization}
      on:generated={onGenerated}
      on:voicechanged={onVoiceChanged}
      on:quantizationchanged={onQuantizationChanged}
    />
    <BookInspector
      {book}
      {selectedVoice}
      {selectedQuantization}
      on:selectionchanged={onSelectionChanged}
    />

    {#if generated.size > 0}
      <h3>Generated audio</h3>
      <div>
        {#each Array.from(generated.entries()) as [id, rec]}
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <audio controls src={rec.url}></audio>
            <div style="min-width:120px">{getChapterTitle(id)}</div>
            <button on:click={() => downloadBlob(id)}>Download WAV</button>
            <button on:click={() => downloadBlobAsMp3(id)}>Download MP3</button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</main>
