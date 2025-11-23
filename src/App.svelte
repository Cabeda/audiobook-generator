<script lang="ts">
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import LandingPage from './components/LandingPage.svelte'
  import type { Book } from './lib/types/book'
  import { piperClient } from './lib/piper/piperClient'

  // Import stores
  import { book, selectedChapters, generatedAudio } from './stores/bookStore'
  import {
    selectedVoice,
    selectedQuantization,
    selectedDevice,
    selectedModel,
  } from './stores/ttsStore'
  import { appTheme, toggleTheme } from './stores/themeStore'
  import { currentLibraryBookId } from './stores/libraryStore'

  // Import library functions
  import { addBook, findBookByTitleAuthor } from './lib/libraryDB'

  // Unified handler for both file uploads and URL imports
  async function onBookLoaded(
    event: CustomEvent<{
      book: Book
      fromLibrary?: boolean
      libraryId?: number
      sourceFile?: File
      sourceUrl?: string
    }>
  ) {
    const providedBook = event.detail.book
    const fromLibrary = event.detail.fromLibrary || false
    const libraryId = event.detail.libraryId
    const sourceFile = event.detail.sourceFile
    const sourceUrl = event.detail.sourceUrl

    if (providedBook) {
      $book = providedBook
      // initialize selected map
      $selectedChapters = new Map(providedBook.chapters.map((c) => [c.id, true]))
      $generatedAudio = new Map()

      // If loaded from library, track the library book ID
      if (fromLibrary && libraryId !== undefined) {
        $currentLibraryBookId = libraryId
      } else {
        // Not from library, save it to library
        await saveBookToLibrary(providedBook, sourceFile, sourceUrl)
        $currentLibraryBookId = null
      }

      // Auto-adapt voice if book language differs from current voice language
      if (providedBook.language) {
        const bookLang = providedBook.language.toLowerCase().substring(0, 2) // Get ISO 639-1 code
        await adaptVoiceToLanguage(bookLang)
      }
    }
  }

  // Save book to library if not already present
  async function saveBookToLibrary(book: Book, sourceFile?: File, sourceUrl?: string) {
    try {
      // Check if book already exists
      const existing = await findBookByTitleAuthor(book.title, book.author)
      if (existing) {
        console.log(`Book "${book.title}" already in library`)
        $currentLibraryBookId = existing.id
        return
      }

      // Add new book to library
      const libraryId = await addBook(book, sourceFile, sourceUrl)
      $currentLibraryBookId = libraryId
      console.log(`Added book "${book.title}" to library with ID ${libraryId}`)
    } catch (err) {
      console.error('Failed to save book to library:', err)
      // Don't block the user if saving fails
    }
  }

  // Auto-select voice based on book language
  async function adaptVoiceToLanguage(bookLang: string) {
    // Get language of current voice
    const currentVoiceLang = getVoiceLanguage($selectedVoice, $selectedModel)

    // If languages match, no need to change
    if (currentVoiceLang === bookLang) return

    console.log(
      `Book language (${bookLang}) differs from current voice language (${currentVoiceLang}), adapting...`
    )

    // Find a matching voice in the current model
    if ($selectedModel === 'piper') {
      const voices = await piperClient.getVoices()
      const matchingVoice = voices.find((v) => v.key.toLowerCase().startsWith(bookLang))
      if (matchingVoice) {
        $selectedVoice = matchingVoice.key
        console.log(`Auto-selected Piper voice: ${$selectedVoice}`)
      }
    } else if ($selectedModel === 'kokoro') {
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
    $selectedChapters = new Map(entries)
  }

  function onGenerated(e: CustomEvent) {
    const { id, blob } = e.detail
    const url = URL.createObjectURL(blob)
    $generatedAudio.set(id, { url, blob })
    // Trigger reactivity for Map
    $generatedAudio = new Map($generatedAudio)
  }

  function downloadBlob(id: string) {
    const rec = $generatedAudio.get(id)
    if (!rec) return
    const a = document.createElement('a')
    a.href = rec.url
    a.download = `${id}.wav`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function downloadBlobAsMp3(id: string) {
    const rec = $generatedAudio.get(id)
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
    if (!$book) return id
    const chapter = $book.chapters.find((c) => c.id === id)
    return chapter?.title || id
  }
</script>

<main>
  {#if !$book}
    <LandingPage on:bookloaded={onBookLoaded} />
  {:else}
    <div class="app-container">
      <div class="header">
        <h1>Audiobook Generator</h1>
        <div class="header-controls">
          <button
            class="theme-toggle"
            onclick={toggleTheme}
            aria-label={`Switch to ${$appTheme === 'light' ? 'dark' : 'light'} mode`}
          >
            {$appTheme === 'light' ? '🌙' : '☀️'}
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
          book={$book}
          selectedMap={$selectedChapters}
          selectedVoice={$selectedVoice}
          selectedQuantization={$selectedQuantization}
          selectedDevice={$selectedDevice}
          selectedModel={$selectedModel}
          on:generated={onGenerated}
          on:voicechanged={(e) => ($selectedVoice = e.detail.voice)}
          on:quantizationchanged={(e) => ($selectedQuantization = e.detail.quantization)}
          on:devicechanged={(e) => ($selectedDevice = e.detail.device)}
          on:modelchanged={(e) => ($selectedModel = e.detail.model)}
        />
        <BookInspector
          book={$book}
          selectedVoice={$selectedVoice}
          selectedQuantization={$selectedQuantization}
          selectedDevice={$selectedDevice}
          selectedModel={$selectedModel}
          on:selectionchanged={onSelectionChanged}
        />

        {#if $generatedAudio.size > 0}
          <div class="generated-section" role="region" aria-labelledby="generated-heading">
            <h3 id="generated-heading">Generated Audio</h3>
            <div class="generated-list">
              {#each Array.from($generatedAudio.entries()) as [id, rec]}
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
