<script lang="ts">
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import LandingPage from './components/LandingPage.svelte'
  import type { Book, Chapter } from './lib/types/book'
  import { getTTSWorker } from './lib/ttsWorkerManager'

  let book: Book | null = null

  // Map of chapter id -> boolean (selected)
  let selectedMap: Map<string, boolean> = new Map()

  // generated audio map: chapter id -> { url, blob }
  let generated = new Map<string, { url: string; blob: Blob }>()

  // TTS options (lifted from GeneratePanel for sharing with BookInspector)
  let selectedVoice: string = 'af_heart'
  let selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16' = 'q8'
  let selectedDevice: 'auto' | 'wasm' | 'webgpu' | 'cpu' = 'auto'

  // Load TTS options from localStorage on mount
  import { onMount } from 'svelte'
  const QUANT_KEY = 'audiobook_quantization'
  const VOICE_KEY = 'audiobook_voice'
  const DEVICE_KEY = 'audiobook_device'

  onMount(() => {
    try {
      const savedVoice = localStorage.getItem(VOICE_KEY)
      if (savedVoice) selectedVoice = savedVoice

      const savedQuant = localStorage.getItem(QUANT_KEY)
      if (savedQuant) selectedQuantization = savedQuant as typeof selectedQuantization

      const savedDevice = localStorage.getItem(DEVICE_KEY)
      if (savedDevice) selectedDevice = savedDevice as typeof selectedDevice
    } catch (e) {
      // ignore (e.g., SSR or privacy mode)
    }
  })

  // Unified handler for both file uploads and URL imports
  function onBookLoaded(event: CustomEvent<{ book: Book }>) {
    const providedBook = event.detail.book
    if (providedBook) {
      book = providedBook
      // initialize selected map
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
      generated.clear()
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

  function onDeviceChanged(e: CustomEvent) {
    selectedDevice = e.detail.device
    try {
      localStorage.setItem(DEVICE_KEY, selectedDevice)
    } catch (e) {
      // ignore
    }
  }
</script>

<main>
  {#if !book}
    <LandingPage on:bookloaded={onBookLoaded} />
  {:else}
    <div class="app-container">
      <div class="header">
        <h1>Audiobook Generator</h1>
        <button class="back-button" on:click={() => window.location.reload()}>
          ← Start Over
        </button>
      </div>

      <div class="main-content">
        <GeneratePanel
          {book}
          {selectedMap}
          {selectedVoice}
          {selectedQuantization}
          {selectedDevice}
          on:generated={onGenerated}
          on:voicechanged={onVoiceChanged}
          on:quantizationchanged={onQuantizationChanged}
          on:devicechanged={onDeviceChanged}
        />
        <BookInspector
          {book}
          {selectedVoice}
          {selectedQuantization}
          on:selectionchanged={onSelectionChanged}
        />

        {#if generated.size > 0}
          <div class="generated-section">
            <h3>Generated Audio</h3>
            <div class="generated-list">
              {#each Array.from(generated.entries()) as [id, rec]}
                <div class="generated-item">
                  <audio controls src={rec.url}></audio>
                  <div class="chapter-title" title={getChapterTitle(id)}>
                    {getChapterTitle(id)}
                  </div>
                  <div class="actions">
                    <button on:click={() => downloadBlob(id)}>WAV</button>
                    <button on:click={() => downloadBlobAsMp3(id)}>MP3</button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .back-button {
    background: transparent;
    border: 1px solid #ddd;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
  }

  .back-button:hover {
    background: #fff;
    border-color: #999;
    color: #333;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .generated-section {
    background: white;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .generated-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .generated-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: #f8f9fa;
    border-radius: 8px;
  }

  .chapter-title {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions button {
    font-size: 0.85rem;
    padding: 6px 12px;
    background: white;
  }

  .actions button:hover {
    background: #f0f0f0;
  }
</style>
