<script lang="ts">
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import LandingPage from './components/LandingPage.svelte'
  import type { Book } from './lib/types/book'
  import { piperClient } from './lib/piper/piperClient'
  import { listVoices as listKokoroVoices, type VoiceId } from './lib/kokoro/kokoroClient'

  let book = $state<Book | null>(null)

  // Map of chapter id -> boolean (selected)
  let selectedMap = $state(new Map<string, boolean>())

  // generated audio map: chapter id -> { url, blob }
  let generated = $state(new Map<string, { url: string; blob: Blob }>())

  // TTS options (lifted from GeneratePanel for sharing with BookInspector)
  let selectedVoice = $state('af_heart')
  let selectedQuantization = $state<'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'>('q8')
  let selectedDevice = $state<'auto' | 'wasm' | 'webgpu' | 'cpu'>('auto')
  let selectedModel = $state<'kokoro' | 'piper'>('kokoro')

  // Load TTS options from localStorage on mount
  import { onMount } from 'svelte'
  const QUANT_KEY = 'audiobook_quantization'
  const VOICE_KEY = 'audiobook_voice'
  const DEVICE_KEY = 'audiobook_device'
  const MODEL_KEY = 'audiobook_model'

  onMount(() => {
    try {
      const savedVoice = localStorage.getItem(VOICE_KEY)
      if (savedVoice) selectedVoice = savedVoice

      const savedQuant = localStorage.getItem(QUANT_KEY)
      if (savedQuant) selectedQuantization = savedQuant as typeof selectedQuantization

      const savedDevice = localStorage.getItem(DEVICE_KEY)
      if (savedDevice) selectedDevice = savedDevice as typeof selectedDevice

      const savedModel = localStorage.getItem(MODEL_KEY)
      if (savedModel) selectedModel = savedModel as typeof selectedModel
    } catch (e) {
      // ignore (e.g., SSR or privacy mode)
    }
  })

  // Unified handler for both file uploads and URL imports
  async function onBookLoaded(event: CustomEvent<{ book: Book }>) {
    const providedBook = event.detail.book
    if (providedBook) {
      book = providedBook
      // initialize selected map
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
      generated.clear()

      // Auto-adapt voice if book language differs from current voice language
      if (book.language) {
        const bookLang = book.language.toLowerCase().substring(0, 2) // Get ISO 639-1 code
        await adaptVoiceToLanguage(bookLang)
      }
    }
  }

  // Auto-select voice based on book language
  async function adaptVoiceToLanguage(bookLang: string) {
    // Get language of current voice
    const currentVoiceLang = getVoiceLanguage(selectedVoice, selectedModel)

    // If languages match, no need to change
    if (currentVoiceLang === bookLang) return

    console.log(
      `Book language (${bookLang}) differs from current voice language (${currentVoiceLang}), adapting...`
    )

    // Find a matching voice in the current model
    if (selectedModel === 'piper') {
      const voices = await piperClient.getVoices()
      const matchingVoice = voices.find((v) => v.key.toLowerCase().startsWith(bookLang))
      if (matchingVoice) {
        selectedVoice = matchingVoice.key
        try {
          localStorage.setItem(VOICE_KEY, selectedVoice)
        } catch (e) {
          // ignore
        }
        console.log(`Auto-selected Piper voice: ${selectedVoice}`)
      }
    } else if (selectedModel === 'kokoro') {
      // Kokoro only has English voices
      if (bookLang !== 'en') {
        console.log(`Book is not English, but Kokoro only supports English. Keeping current voice.`)
      }
    }
  }

  // Helper to extract language from voice ID
  function getVoiceLanguage(voice: string, model: 'kokoro' | 'piper'): string {
    if (model === 'kokoro') {
      return 'en' // All Kokoro voices are English
    } else {
      // Piper voice IDs start with language code (e.g., 'en_US-...', 'es_ES-...')
      const match = voice.match(/^([a-z]{2})_/i)
      return match ? match[1].toLowerCase() : 'en'
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
    // trigger reactivity - NOT NEEDED in Svelte 5 with $state(Map)
    // generated = new Map(generated)
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

  function onModelChanged(e: CustomEvent) {
    selectedModel = e.detail.model
    try {
      localStorage.setItem(MODEL_KEY, selectedModel)
    } catch (e) {
      // ignore
    }
  }
  // Global Theme
  const APP_THEME_KEY = 'app_theme'
  let appTheme = $state<'light' | 'dark'>('light')

  onMount(() => {
    try {
      const savedTheme = localStorage.getItem(APP_THEME_KEY)
      if (savedTheme === 'dark' || savedTheme === 'light') {
        appTheme = savedTheme
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        appTheme = 'dark'
      }
    } catch (e) {
      // ignore
    }
  })

  $effect(() => {
    document.body.setAttribute('data-theme', appTheme)
    try {
      localStorage.setItem(APP_THEME_KEY, appTheme)
    } catch (e) {
      // ignore
    }
  })

  function toggleTheme() {
    appTheme = appTheme === 'light' ? 'dark' : 'light'
  }
</script>

<main>
  {#if !book}
    <LandingPage on:bookloaded={onBookLoaded} />
  {:else}
    <div class="app-container">
      <div class="header">
        <h1>Audiobook Generator</h1>
        <div class="header-controls">
          <button
            class="theme-toggle"
            onclick={toggleTheme}
            aria-label={`Switch to ${appTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {appTheme === 'light' ? '🌙' : '☀️'}
          </button>
          <button
            class="back-button"
            onclick={() => window.location.reload()}
            aria-label="Start over with a new book"
          >
            ← Start Over
          </button>
        </div>
      </div>

      <div class="main-content">
        <GeneratePanel
          {book}
          {selectedMap}
          {selectedVoice}
          {selectedQuantization}
          {selectedDevice}
          {selectedModel}
          on:generated={onGenerated}
          on:voicechanged={onVoiceChanged}
          on:quantizationchanged={onQuantizationChanged}
          on:devicechanged={onDeviceChanged}
          on:modelchanged={onModelChanged}
        />
        <BookInspector
          {book}
          {selectedVoice}
          {selectedQuantization}
          {selectedDevice}
          {selectedModel}
          on:selectionchanged={onSelectionChanged}
        />

        {#if generated.size > 0}
          <div class="generated-section" role="region" aria-labelledby="generated-heading">
            <h3 id="generated-heading">Generated Audio</h3>
            <div class="generated-list">
              {#each Array.from(generated.entries()) as [id, rec]}
                <div class="generated-item">
                  <audio controls src={rec.url} aria-label={`Audio for ${getChapterTitle(id)}`}
                  ></audio>
                  <div class="chapter-title" title={getChapterTitle(id)}>
                    {getChapterTitle(id)}
                  </div>
                  <div class="actions">
                    <button
                      onclick={() => downloadBlob(id)}
                      aria-label={`Download WAV for ${getChapterTitle(id)}`}>WAV</button
                    >
                    <button
                      onclick={() => downloadBlobAsMp3(id)}
                      aria-label={`Download MP3 for ${getChapterTitle(id)}`}>MP3</button
                    >
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

  .header-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .theme-toggle {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-color);
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 1.2rem;
    transition: all 0.2s;
  }

  .theme-toggle:hover {
    background: var(--surface-color);
    border-color: var(--text-color);
  }

  .back-button {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--secondary-text);
    cursor: pointer;
    padding: 8px 16px;
    border-radius: 6px;
    transition: all 0.2s;
  }

  .back-button:hover {
    background: var(--surface-color);
    border-color: var(--text-color);
    color: var(--text-color);
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
