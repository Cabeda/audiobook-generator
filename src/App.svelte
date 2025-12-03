<script lang="ts">
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import LandingPage from './components/LandingPage.svelte'
  import Toast from './components/Toast.svelte'
  import PersistentPlayer from './components/PersistentPlayer.svelte'
  import TextReader from './components/TextReader.svelte'
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
  import { audioPlayerStore, isPlayerActive, isPlayerMinimized } from './stores/audioPlayerStore'
  import { audioService } from './lib/audioPlaybackService.svelte'

  // Import library functions
  import {
    addBook,
    findBookByTitleAuthor,
    getBook,
    saveChapterAudio,
    getChapterAudio,
    type AudioGenerationSettings,
  } from './lib/libraryDB'
  import { onMount } from 'svelte'
  import type { Chapter } from './lib/types/book'

  // View state management
  type ViewType = 'landing' | 'book' | 'reader'
  let currentView = $state<ViewType>('landing')
  let currentChapter = $state<Chapter | null>(null)

  // Navigation handlers
  function navigateToReader(chapter: Chapter) {
    currentChapter = chapter
    currentView = 'reader'
    // Only initialize a new audio session if the audio player isn't already
    // playing the same chapter with the same settings. This prevents a
    // full restart when users click 'Read' while already listening in the
    // persistent player.
    const store = $audioPlayerStore
    const sameChapter = store.chapterId === chapter.id && store.bookId === $currentLibraryBookId

    if (!sameChapter) {
      try {
        audioService.initialize($currentLibraryBookId, $book?.title || '', chapter, {
          voice: $selectedVoice,
          quantization: $selectedQuantization,
          device: $selectedDevice,
          selectedModel: $selectedModel,
          playbackSpeed: audioService.playbackSpeed,
        })
        audioService
          .play()
          .catch((err) => console.debug('Auto-play failed from navigateToReader:', err))
      } catch (err) {
        console.error('Failed to initialize audio service from navigateToReader:', err)
      }
    }

    // Maximize player to hide persistent bar when in reader
    if ($isPlayerActive) {
      audioPlayerStore.maximize()
    }
    // Update the url so refresh persists
    try {
      const id = $currentLibraryBookId ?? 'unsaved'
      location.hash = `#/reader/${id}/${encodeURIComponent(chapter.id)}`
    } catch (e) {
      // noop
    }
  }

  function navigateToBook() {
    currentView = 'book'
    // Minimize player if it's active
    if ($isPlayerActive) {
      audioPlayerStore.minimize()
    }
    // Update url
    try {
      const id = $currentLibraryBookId ?? 'unsaved'
      location.hash = `#/book/${id}`
    } catch (e) {
      // noop
    }
  }

  function navigateToLanding() {
    currentView = 'landing'
    currentChapter = null
    // Minimize player if it's active so it shows as persistent bar
    if ($isPlayerActive) {
      audioPlayerStore.minimize()
    }
    // Update url
    try {
      location.hash = `#/` // root
    } catch (e) {
      // noop
    }
  }

  // Helper to initialize book state
  async function initializeBookState(b: Book, libraryId: number) {
    $book = b
    $currentLibraryBookId = libraryId
    $selectedChapters = new Map(b.chapters.map((c) => [c.id, true]))
    $generatedAudio = new Map()

    // Load persisted audio for this book
    try {
      const audioMap = new Map()
      for (const ch of b.chapters) {
        const blob = await getChapterAudio(libraryId, ch.id)
        if (blob) {
          const url = URL.createObjectURL(blob)
          audioMap.set(ch.id, { url, blob })
        }
      }
      if (audioMap.size > 0) {
        $generatedAudio = audioMap
      }
    } catch (err) {
      console.warn('Failed to load persisted audio:', err)
    }

    if (b.language) {
      const bookLang = b.language.toLowerCase().substring(0, 2)
      await adaptVoiceToLanguage(bookLang)
    }
  }

  // Handle maximize from persistent player
  function handlePlayerMaximize() {
    // If we already have the current chapter set, just navigate to reader
    if (currentChapter) {
      currentView = 'reader'
      audioPlayerStore.maximize()
      try {
        const id = $currentLibraryBookId ?? 'unsaved'
        location.hash = `#/reader/${id}/${encodeURIComponent(currentChapter.id)}`
      } catch (e) {
        // noop
      }
      return
    }

    // Otherwise, try to restore from the saved player state
    const saved = $audioPlayerStore
    if (saved && saved.bookId && saved.chapterId) {
      // If our current book is the same as saved, use it, otherwise load the book
      if ($currentLibraryBookId === saved.bookId && $book) {
        const ch = $book.chapters.find((c) => c.id === saved.chapterId)
        if (ch) {
          currentChapter = ch
          currentView = 'reader'
          audioPlayerStore.maximize()
          try {
            location.hash = `#/reader/${saved.bookId}/${encodeURIComponent(ch.id)}`
          } catch (e) {
            // noop
          }
          return
        }
      }

      getBook(saved.bookId)
        .then(async (b) => {
          if (b) {
            await initializeBookState(b, saved.bookId!)
            const ch = b.chapters.find((c) => c.id === saved.chapterId)
            if (ch) {
              currentChapter = ch
              currentView = 'reader'
              audioPlayerStore.maximize()
              try {
                location.hash = `#/reader/${saved.bookId}/${encodeURIComponent(ch.id)}`
              } catch (e) {
                // noop
              }
            }
          }
        })
        .catch((err) => console.warn('Failed to load book for player maximize', err))
    }
  }

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

      // Navigate to book view, ensure it's saved to library first
      // If the book didn't come from library we'll save it — saveBookToLibrary will set $currentLibraryBookId
      await saveBookToLibrary(providedBook, sourceFile, sourceUrl)

      // Initialize state (including loading audio)
      if ($currentLibraryBookId) {
        await initializeBookState(providedBook, $currentLibraryBookId)
      }

      currentView = 'book'
      try {
        const id = $currentLibraryBookId ?? 'unsaved'
        location.hash = `#/book/${id}`
      } catch (e) {
        // noop
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

  // Hash-based routing helpers -------------------------------------------------
  async function applyRouteFromHash(hash?: string) {
    const h = (hash ?? location.hash).replace(/^#/, '') || '/'
    const parts = h.split('/').filter(Boolean)

    if (parts.length === 0) {
      // landing - upload view
      currentView = 'landing'
      currentChapter = null
      return
    }

    const [first, second, third] = parts

    // Handle library view
    if (first === 'library') {
      currentView = 'landing'
      currentChapter = null
      // The LandingPage component will handle showing the library view
      return
    }

    // Handle upload view (optional explicit route)
    if (first === 'upload') {
      currentView = 'landing'
      currentChapter = null
      return
    }

    if (first === 'book') {
      const id = parseInt(second)
      if (Number.isFinite(id)) {
        try {
          const b = await getBook(id)
          if (b) {
            await initializeBookState(b, id)
            currentView = 'book'
            currentChapter = null
            // No route-based audio initialization on 'book' route — the persistent player will be used.
            return
          } else {
            // Book not found - redirect to landing
            console.warn(`Book with ID ${id} not found, redirecting to landing`)
            location.hash = '#/'
            currentView = 'landing'
            currentChapter = null
            return
          }
        } catch (err) {
          console.error('Failed to load book from route', err)
          // On error, redirect to landing
          location.hash = '#/'
          currentView = 'landing'
          currentChapter = null
          return
        }
      }
      // If we don't have a valid ID, fall back to landing
      console.warn(`Invalid book ID in route: ${second}, redirecting to landing`)
      location.hash = '#/'
      currentView = 'landing'
      currentChapter = null
      return
    }

    if (first === 'reader') {
      const id = parseInt(second)
      const chapterId = decodeURIComponent(third || '')
      if (Number.isFinite(id) && chapterId) {
        try {
          const b = await getBook(id)
          if (b) {
            // If book is not already loaded or different, initialize it
            if (!$book || $currentLibraryBookId !== id) {
              await initializeBookState(b, id)
            }
            const ch = b.chapters.find((c) => c.id === chapterId)
            if (ch) {
              currentChapter = ch
              // Delay to ensure view state is synchronized before attempting to init audio
              currentView = 'reader'
              // Ensure audio player is set to this chapter
              try {
                const playback = $audioPlayerStore
                // Avoid re-initialization if playback is already set to this book and chapter
                if (playback.bookId === id && playback.chapterId === ch.id) {
                  // Playback already set for this book/chapter — ensure playback speed is synced but don't reinitialize
                  audioService.setSpeed(playback.playbackSpeed)
                } else {
                  const saved = $audioPlayerStore
                  if (saved.bookId === id && saved.chapterId === ch.id) {
                    audioService.initialize(
                      $currentLibraryBookId,
                      $book?.title || '',
                      ch,
                      {
                        voice: saved.voice,
                        quantization: saved.quantization,
                        device: saved.device,
                        selectedModel: saved.selectedModel,
                        playbackSpeed: saved.playbackSpeed,
                      },
                      {
                        startSegmentIndex: saved.segmentIndex,
                        startTime: saved.currentTime,
                        startPlaying: false,
                        startMinimized: saved.isMinimized,
                      }
                    )
                  } else {
                    audioService.initialize($currentLibraryBookId, $book?.title || '', ch, {
                      voice: $selectedVoice,
                      quantization: $selectedQuantization,
                      device: $selectedDevice,
                      selectedModel: $selectedModel,
                      playbackSpeed: audioService.playbackSpeed,
                    })
                  }
                }
                // Do not auto-play on reload to avoid surprising the user
              } catch (err) {
                console.error('Failed to init audio from route', err)
              }
              return
            } else {
              // Chapter not found - redirect to book view
              console.warn(`Chapter ${chapterId} not found in book ${id}, redirecting to book view`)
              location.hash = `#/book/${id}`
              currentView = 'book'
              currentChapter = null
              return
            }
          } else {
            // Book not found - redirect to landing
            console.warn(`Book with ID ${id} not found, redirecting to landing`)
            location.hash = '#/'
            currentView = 'landing'
            currentChapter = null
            return
          }
        } catch (err) {
          console.error('Failed to load reader route', err)
          // On error, redirect to landing
          location.hash = '#/'
          currentView = 'landing'
          currentChapter = null
          return
        }
      }
      // If the route couldn't be handled, fall back to landing
      console.warn(`Invalid reader route: ${h}, redirecting to landing`)
      location.hash = '#/'
      currentView = 'landing'
      currentChapter = null
      return
    }

    // Unknown route: landing
    console.warn(`Unknown route: ${h}, redirecting to landing`)
    location.hash = '#/'
    currentView = 'landing'
    currentChapter = null
  }

  onMount(async () => {
    // Initialize route on load - MUST await this to prevent race condition
    // where saved player state overrides the URL-based book loading
    await applyRouteFromHash()

    // And handle back/forward navigation
    const handler = () => applyRouteFromHash()
    window.addEventListener('hashchange', handler)

    // If we have a saved player state for a book and no route was loaded, attempt to load the book and restore
    // Only do this AFTER route resolution completes to avoid overriding URL-based navigation
    const saved = $audioPlayerStore
    if ($currentLibraryBookId === null && saved.bookId !== null) {
      getBook(saved.bookId)
        .then(async (b) => {
          if (b) {
            await initializeBookState(b, saved.bookId!)
            // If the store has a saved chapter, restore on the player
            const ch = b.chapters.find((c) => c.id === saved.chapterId)
            if (ch) {
              audioService.initialize(
                saved.bookId,
                b.title,
                ch,
                {
                  voice: saved.voice,
                  quantization: saved.quantization,
                  device: saved.device,
                  selectedModel: saved.selectedModel,
                  playbackSpeed: saved.playbackSpeed,
                },
                {
                  startSegmentIndex: saved.segmentIndex,
                  startTime: saved.currentTime,
                  startPlaying: saved.isPlaying,
                }
              )
            }
          }
        })
        .catch((err) => console.warn('Failed to restore playback book on load', err))
    }

    return () => window.removeEventListener('hashchange', handler)
  })

  function onGenerated(e: CustomEvent) {
    const { id, blob } = e.detail
    const url = URL.createObjectURL(blob)
    $generatedAudio.set(id, { url, blob })
    // Trigger reactivity for Map
    $generatedAudio = new Map($generatedAudio)

    // Persist to IndexedDB if we have a valid library book ID
    if ($currentLibraryBookId) {
      const settings: AudioGenerationSettings = {
        model: $selectedModel,
        voice: $selectedVoice,
        quantization: $selectedModel === 'kokoro' ? $selectedQuantization : undefined,
        device: $selectedModel === 'kokoro' ? $selectedDevice : undefined,
      }
      saveChapterAudio($currentLibraryBookId, id, blob, settings).catch((err) =>
        console.error('Failed to persist generated audio:', err)
      )
    }
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
  import ReloadPrompt from './components/ReloadPrompt.svelte'
</script>

<main class:has-player={$isPlayerActive && currentView !== 'reader'}>
  <ReloadPrompt />
  <Toast />

  {#if currentView === 'landing'}
    <LandingPage on:bookloaded={onBookLoaded} />
  {:else if currentView === 'book' && $book}
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
            onclick={navigateToLanding}
            aria-label="Return to landing page"
          >
            ← Start Over
          </button>
        </div>
      </div>

      <div class="main-content">
        <GeneratePanel
          book={$book}
          bookId={$currentLibraryBookId}
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
          generatedAudioMap={$generatedAudio}
          selectedVoice={$selectedVoice}
          selectedQuantization={$selectedQuantization}
          selectedDevice={$selectedDevice}
          selectedModel={$selectedModel}
          on:selectionchanged={onSelectionChanged}
          on:readchapter={(e) => navigateToReader(e.detail.chapter)}
          on:downloadwav={(e) => downloadBlob(e.detail.id)}
          on:downloadmp3={(e) => downloadBlobAsMp3(e.detail.id)}
        />
      </div>
    </div>
  {:else if currentView === 'reader' && currentChapter && $book}
    <TextReader
      chapter={currentChapter}
      bookId={$currentLibraryBookId}
      bookTitle={$book.title}
      voice={$selectedVoice}
      quantization={$selectedQuantization}
      device={$selectedDevice}
      selectedModel={$selectedModel}
      onBack={navigateToBook}
      onChapterChange={(chapter) => {
        currentChapter = chapter
      }}
    />
  {/if}
</main>

<!-- Persistent Audio Player -->
{#if $isPlayerActive && currentView !== 'reader'}
  <PersistentPlayer onMaximize={handlePlayerMaximize} />
{/if}

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

  main.has-player {
    padding-bottom: 120px;
  }
</style>
