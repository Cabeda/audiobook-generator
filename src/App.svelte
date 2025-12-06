<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'

  // Components
  import LandingPage from './components/LandingPage.svelte'
  import BookView from './components/BookView.svelte'
  import TextReader from './components/TextReader.svelte'
  import Toast from './components/Toast.svelte'
  import PersistentPlayer from './components/PersistentPlayer.svelte'
  import ReloadPrompt from './components/ReloadPrompt.svelte'
  import AudioPlayerBar from './components/AudioPlayerBar.svelte' // Use if needed globally? Setup suggests inline/persistent.

  // APIs & Logic
  import { listVoices as listKokoroVoices } from './lib/kokoro/kokoroClient'
  import { piperClient } from './lib/piper/piperClient'
  import type { Book, Chapter } from './lib/types/book'

  // Stores
  import {
    book,
    selectedChapters,
    generatedAudio,
    chapterStatus,
    chapterErrors,
  } from './stores/bookStore'
  import {
    selectedModel,
    selectedVoice,
    availableVoices,
    selectedQuantization,
    selectedDevice,
    voiceLabels,
    lastKokoroVoice,
    lastPiperVoice,
    lastWebSpeechVoice,
  } from './stores/ttsStore'
  import { audioPlayerStore } from './stores/audioPlayerStore'
  import { currentLibraryBookId } from './stores/libraryStore'
  import { appTheme as theme } from './stores/themeStore'

  // State
  type ViewType = 'landing' | 'book' | 'reader'
  let currentView = $state<ViewType>('landing')
  let currentChapter = $state<Chapter | null>(null) // For Reader

  // Voice Loading Logic (Centralized)
  let kokoroVoices = listKokoroVoices()

  async function loadPiperVoices() {
    try {
      const voices = await piperClient.getVoices()
      return voices.map((v) => ({
        id: v.key,
        label: `${v.name} (${v.language}) - ${v.quality}`,
      }))
    } catch (e) {
      console.error('Failed to load Piper voices', e)
      return []
    }
  }

  function loadWebSpeechVoices() {
    const voices = window.speechSynthesis.getVoices()
    return voices.map((v) => ({
      id: v.name,
      label: `${v.name} (${v.lang})`,
    }))
  }

  // Reactive Voice Updater
  $effect(() => {
    const model = $selectedModel
    if (model === 'kokoro') {
      availableVoices.set(
        kokoroVoices.map((v) => ({
          id: v,
          label: voiceLabels[v] || v,
        }))
      )
      // Restore last voice
      untrack(() => {
        if (kokoroVoices.includes($lastKokoroVoice as any)) {
          selectedVoice.set($lastKokoroVoice)
        }
      })
    } else if (model === 'piper') {
      availableVoices.set([]) // Clear while loading
      loadPiperVoices().then((voices) => {
        if ($selectedModel === 'piper') {
          availableVoices.set(voices)
          untrack(() => {
            /* Logic to restore last Piper voice */
            const last = $lastPiperVoice
            if (voices.find((v) => v.id === last)) {
              selectedVoice.set(last)
            } else if (voices.length > 0) {
              selectedVoice.set(voices[0].id)
            }
          })
        }
      })
    } else if (model === 'web_speech') {
      const voices = loadWebSpeechVoices()
      availableVoices.set(voices)
      untrack(() => {
        const last = $lastWebSpeechVoice
        if (voices.find((v) => v.id === last)) {
          selectedVoice.set(last)
        } else if (voices.length > 0) {
          selectedVoice.set(voices[0].id)
        }
      })
    }
  })

  // Event Handlers
  function navigateToReader(chapter: Chapter) {
    currentChapter = chapter
    currentView = 'reader'
    // Deep link logic
    try {
      const id = $currentLibraryBookId ?? 'unsaved'
      location.hash = `#/reader/${id}/${encodeURIComponent(chapter.id)}`
    } catch (e) {
      console.error('Failed to navigate to reader', e)
    }
  }

  function navigateToBook() {
    currentView = 'book'
    if ($audioPlayerStore) {
      audioPlayerStore.minimize()
    }
    try {
      const id = $currentLibraryBookId ?? 'unsaved'
      location.hash = `#/book/${id}`
    } catch (e) {
      console.error('Failed to navigate to book', e)
    }
  }

  function handleBackFromReader() {
    navigateToBook()
  }

  // Book Loading
  async function onBookLoaded(event: CustomEvent) {
    const b = event.detail.book
    if (b) {
      book.set(b) // Store handles state reset

      if (event.detail.libraryId) {
        currentLibraryBookId.set(event.detail.libraryId)
      } else {
        // New import - save to library automatically
        try {
          const { addBook } = await import('./lib/libraryDB')
          const id = await addBook(b)
          currentLibraryBookId.set(id)
          // Also refresh library list if we are listener
          const { refreshLibrary } = await import('./stores/libraryStore')
          refreshLibrary()
        } catch (e) {
          console.error('Failed to save book to library', e)
        }
      }

      currentView = 'book'
    }
  }

  // Initialization
  onMount(() => {
    // Web Speech Init
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        if ($selectedModel === 'web_speech') {
          availableVoices.set(loadWebSpeechVoices())
        }
      }
    }

    // Hash Routing for persistence
    const handleHash = async () => {
      const hash = location.hash
      if (!hash || hash === '#/') {
        // Landing page
        if (currentView !== 'landing' && !$book) {
          currentView = 'landing'
        }
        return
      }

      // Parse hash: #/book/:id or #/reader/:id/:chapterId
      const match = hash.match(/^#\/(book|reader)\/([^/]+)(?:\/(.+))?$/)
      if (!match) return

      const [, view, bookId, chapterId] = match

      // Load book if not already loaded or different book
      if (bookId !== 'unsaved') {
        const id = parseInt(bookId, 10)
        if (!isNaN(id)) {
          // Check if we need to load
          const needsLoad = !$book || $currentLibraryBookId !== id
          if (needsLoad) {
            try {
              const { getBook } = await import('./lib/libraryDB')
              const loadedBook = await getBook(id)
              if (loadedBook) {
                book.set(loadedBook)
                currentLibraryBookId.set(id)
              }
            } catch (e) {
              console.error('Failed to load book from hash:', e)
              location.hash = '#/'
              return
            }
          }
        }
      }

      // Navigate to the correct view
      if (view === 'book') {
        currentView = 'book'
        currentChapter = null
      } else if (view === 'reader' && chapterId && $book) {
        const decodedChapterId = decodeURIComponent(chapterId)
        const chapter = $book.chapters.find((c) => c.id === decodedChapterId)
        if (chapter) {
          currentChapter = chapter
          currentView = 'reader'
        }
      }
    }

    // Initial hash handling
    handleHash()

    window.addEventListener('hashchange', handleHash)
    return () => window.removeEventListener('hashchange', handleHash)
  })

  // Theme application
  $effect(() => {
    document.documentElement.setAttribute('data-theme', $theme)
  })
</script>

<main class="app-container">
  <Toast />
  <ReloadPrompt />

  {#if currentView === 'landing'}
    <div in:fade>
      <LandingPage on:bookloaded={onBookLoaded} />
    </div>
  {:else if currentView === 'book'}
    <div in:fade class="view-wrapper">
      <button class="back-link" onclick={() => (currentView = 'landing')}>← Library</button>
      <BookView on:read={(e) => navigateToReader(e.detail.chapter)} />
    </div>
  {:else if currentView === 'reader' && currentChapter}
    <div in:fade class="view-wrapper full-height">
      <TextReader
        chapter={currentChapter}
        bookId={$currentLibraryBookId}
        bookTitle={$book?.title ?? ''}
        voice={$selectedVoice}
        quantization={$selectedQuantization}
        device={$selectedDevice}
        selectedModel={$selectedModel}
        onBack={handleBackFromReader}
      />
    </div>
  {/if}

  <!-- Persistent Player (always present if audio is playing) -->
  <PersistentPlayer
    onMaximize={() => {
      // Handle maximize logic (navigate to reader if possible)
      if (currentChapter) {
        currentView = 'reader'
      }
    }}
  />
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .view-wrapper {
    flex: 1;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .view-wrapper.full-height {
    padding: 0;
  }

  .back-link {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 8px 0;
  }

  .back-link:hover {
    color: var(--primary-color);
  }
</style>
