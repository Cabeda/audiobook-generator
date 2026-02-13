<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'

  // Components
  import LandingPage from './components/LandingPage.svelte'
  import BookView from './components/BookView.svelte'
  import TextReader from './components/TextReader.svelte'
  import SettingsPage from './components/SettingsPage.svelte'
  import Toast from './components/Toast.svelte'
  import ReloadPrompt from './components/ReloadPrompt.svelte'

  // APIs & Logic
  import { listVoices as listKokoroVoices } from './lib/kokoro/kokoroClient'
  import { piperClient } from './lib/piper/piperClient'
  import { buildBookHash, buildReaderHash, parseHash } from './lib/utils/hashRoutes'
  import { isKokoroLanguageSupported, selectPiperVoiceForLanguage } from './lib/utils/voiceSelector'
  import { resolveChapterLanguageWithDetection } from './lib/utils/languageResolver'
  import { generationService } from './lib/services/generationService'
  import type { Chapter } from './lib/types/book'

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
  } from './stores/ttsStore'
  import { audioPlayerStore } from './stores/audioPlayerStore'
  import { currentLibraryBookId } from './stores/libraryStore'
  import { appTheme as theme } from './stores/themeStore'

  // State
  type ViewType = 'landing' | 'book' | 'reader' | 'settings'
  let currentView = $state<ViewType>('landing')
  let currentChapter = $state<Chapter | null>(null) // For Reader

  // Computed Reader Settings (Respect Chapter Overrides + Language Fallback)
  // This logic mirrors ChapterItem.svelte's effectiveModel/effectiveVoice computation

  // Compute effective language for the current chapter
  let readerLanguage = $derived.by(() => {
    if (!currentChapter || !$book) return 'en'
    return resolveChapterLanguageWithDetection(currentChapter, $book)
  })

  // Compute effective model (with language-based fallback from Kokoro to Piper)
  let readerModel = $derived.by(() => {
    const baseModel = currentChapter?.model || $selectedModel
    // If Kokoro is selected but doesn't support the language, fallback to Piper
    if (baseModel === 'kokoro' && !isKokoroLanguageSupported(readerLanguage)) {
      return 'piper' as const
    }
    return baseModel as 'kokoro' | 'piper'
  })

  // Compute effective voice considering model fallback
  let readerVoice = $derived.by(() => {
    // 1. Explicit chapter voice override
    if (currentChapter?.voice) {
      // Verify the voice is compatible with the effective model
      // If model changed due to fallback, the explicit voice might be incompatible
      return currentChapter.voice
    }

    // 2. No chapter override - check if using global settings
    const baseModel = currentChapter?.model || $selectedModel
    if (readerModel === baseModel && baseModel === $selectedModel) {
      // Model didn't change due to fallback, use global voice
      return $selectedVoice
    }

    // 3. Model changed due to language fallback - need to pick appropriate voice
    if (readerModel === 'piper') {
      // For Piper, select a voice appropriate for the chapter language
      return selectPiperVoiceForLanguage(readerLanguage, piperVoicesRaw)
    }
    if (readerModel === 'kokoro') {
      return 'af_heart' // Default Kokoro voice
    }

    return $selectedVoice
  })

  // Voice Loading Logic (Centralized)
  let kokoroVoices = listKokoroVoices()
  // Store raw Piper voice metadata for language-based selection
  let piperVoicesRaw = $state<
    Array<{ key: string; name: string; language: string; quality: string }>
  >([])

  async function loadPiperVoices() {
    try {
      const voices = await piperClient.getVoices()
      // Store raw voices for language-based selection
      piperVoicesRaw = voices
      return voices.map((v) => ({
        id: v.key,
        label: `${v.name} (${v.language}) - ${v.quality}`,
      }))
    } catch (e) {
      console.error('Failed to load Piper voices', e)
      return []
    }
  }

  // Preload Piper voices on mount for language-based selection
  onMount(() => {
    loadPiperVoices()
  })

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
    }
  })

  // Event Handlers
  function navigateToReader(chapter: Chapter) {
    currentChapter = chapter
    currentView = 'reader'
    // Deep link logic
    try {
      const id = $currentLibraryBookId ?? 'unsaved'
      location.hash = buildReaderHash(id, chapter.id, $book)
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
      location.hash = buildBookHash(id, $book)
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
        location.hash = buildBookHash(event.detail.libraryId, b)
      } else {
        // New import - save to library automatically
        try {
          const { addBook } = await import('./lib/libraryDB')
          const id = await addBook(b)
          currentLibraryBookId.set(id)

          // Patch the in-memory book with DB metadata so isLibraryBook checks pass
          // and chapter settings (voice, model, language) can be persisted immediately.
          // Mutate directly to avoid triggering book.subscribe which resets all state.
          ;(b as any).id = id
          ;(b as any).dateAdded = Date.now()
          ;(b as any).lastAccessed = Date.now()

          // Run language detection in background (non-blocking)
          try {
            const { detectAndPersistLanguagesForBook } = await import(
              './lib/services/languageDetectionService'
            )
            // Fire and forget - don't block UI
            detectAndPersistLanguagesForBook(id, b)
              .then(async () => {
                // After detection, reload the book to update in-memory object with detected language
                try {
                  const { getBook } = await import('./lib/libraryDB')
                  const updatedBook = await getBook(id)
                  if (updatedBook) {
                    book.set(updatedBook)
                  }
                } catch (reloadError) {
                  console.warn('Failed to reload book after language detection:', reloadError)
                }
              })
              .catch((err) => {
                console.warn('Language detection failed but continuing:', err)
              })
          } catch (detectionError) {
            console.warn('Could not start language detection:', detectionError)
          }

          // Also refresh library list if we are listener
          const { refreshLibrary } = await import('./stores/libraryStore')
          refreshLibrary()
          location.hash = buildBookHash(id, b)
        } catch (e) {
          console.error('Failed to save book to library', e)
        }
      }

      currentView = 'book'

      // Auto-generate on new imports only (not when reopening library books)
      if (!event.detail.fromLibrary && b.chapters?.length > 0) {
        // Select all chapters and start generation
        selectedChapters.update((m) => {
          const newMap = new Map(m)
          b.chapters.forEach((c: Chapter) => newMap.set(c.id, true))
          return newMap
        })
        // Fire and forget - don't block UI
        generationService.generateChapters(b.chapters).catch((err) => {
          console.warn('Auto-generation failed but continuing:', err)
        })
      }
    }
  }

  // Initialization
  onMount(() => {
    // Hash Routing for persistence
    const handleHash = async () => {
      const parsed = parseHash(location.hash)
      if (!parsed) return

      if (parsed.view === 'landing') {
        if (currentView !== 'landing' && !$book) {
          currentView = 'landing'
        }
        return
      }

      const bookId = parsed.bookId
      const chapterId = parsed.view === 'reader' ? parsed.chapterId : undefined

      // Load book if not already loaded or different book
      if (bookId !== 'unsaved') {
        const id = typeof bookId === 'string' ? parseInt(bookId, 10) : bookId
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
      if (parsed.view === 'book') {
        currentView = 'book'
        currentChapter = null
      } else if (parsed.view === 'reader' && chapterId && $book) {
        const chapter = $book.chapters.find((c) => c.id === chapterId)
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
    // Update mobile status bar color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', $theme === 'dark' ? '#0f172a' : '#ffffff')
    }
  })
</script>

<a href="#main-content" class="skip-link">Skip to main content</a>

<main class="app-container" id="main-content">
  <Toast />
  <ReloadPrompt />

  {#if currentView === 'landing'}
    <div in:fade>
      <LandingPage
        on:bookloaded={onBookLoaded}
        on:opensettings={() => (currentView = 'settings')}
      />
    </div>
  {:else if currentView === 'settings'}
    <div in:fade class="view-wrapper">
      <SettingsPage onBack={() => (currentView = 'landing')} />
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
        voice={readerVoice}
        quantization={$selectedQuantization}
        device={$selectedDevice}
        selectedModel={readerModel}
        onBack={handleBackFromReader}
      />
    </div>
  {/if}
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    /* Safe Area Insets for Mobile */
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
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
    padding: 12px 0; /* Increased touch target */
    min-height: 44px; /* Minimum touch target size */
    display: flex;
    align-items: center;
  }

  .back-link:hover {
    color: var(--primary-color);
  }

  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--primary-color, #3b82f6);
    color: white;
    padding: 8px 16px;
    text-decoration: none;
    z-index: 10000;
    border-radius: 0 0 4px 0;
  }

  .skip-link:focus {
    top: 0;
  }
</style>
