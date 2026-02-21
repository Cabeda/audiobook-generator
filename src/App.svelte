<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'

  // Components
  import LandingPage from './components/LandingPage.svelte'
  import BookView from './components/BookView.svelte'
  import TextReader from './components/TextReader.svelte'
  import ContinuousReader from './components/ContinuousReader.svelte'
  import SettingsPage from './components/SettingsPage.svelte'
  import Toast from './components/Toast.svelte'
  import ToastContainer from './components/ToastContainer.svelte'
  import ReloadPrompt from './components/ReloadPrompt.svelte'

  // APIs & Logic
  import { listVoices as listKokoroVoices } from './lib/kokoro/kokoroVoices'
  import { piperVoices, loadPiperVoices } from './stores/piperVoicesStore'
  import { buildBookHash, buildReaderHash, parseHash } from './lib/utils/hashRoutes'
  import { isKokoroLanguageSupported, selectPiperVoiceForLanguage } from './lib/utils/voiceSelector'
  import { resolveChapterLanguageWithDetection } from './lib/utils/languageResolver'
  import { generationService } from './lib/services/generationService'
  import type { Chapter, Book } from './lib/types/book'

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
  import { appSettings } from './stores/appSettingsStore'

  // State
  type ViewType = 'landing' | 'book' | 'reader' | 'settings'
  let currentView = $state<ViewType>('landing')
  let currentChapter = $state<Chapter | null>(null) // For Reader
  let readerMode = $state<'single' | 'continuous'>('single')

  // Persist reader mode preference
  try {
    const saved = localStorage.getItem('reader_mode')
    if (saved === 'continuous') readerMode = 'continuous'
  } catch {
    // localStorage unavailable
  }

  // Computed Reader Settings (Respect Chapter Overrides + Language Fallback)
  // This logic mirrors ChapterItem.svelte's effectiveModel/effectiveVoice computation

  // Compute effective language for the current chapter
  let readerLanguage = $derived.by(() => {
    if (!currentChapter || !$book) return 'en'
    return resolveChapterLanguageWithDetection(currentChapter, $book)
  })

  // Compute effective model (with language-based fallback from Kokoro to Piper)
  // Priority: chapter override > app language default > global toolbar selection
  let readerModel = $derived.by(() => {
    const langDefault = $appSettings.languageDefaults[readerLanguage]
    const baseModel = currentChapter?.model || langDefault?.model || $selectedModel
    // If Kokoro is selected but doesn't support the language, fallback to Piper
    if (baseModel === 'kokoro' && !isKokoroLanguageSupported(readerLanguage)) {
      return 'piper' as const
    }
    return baseModel as 'kokoro' | 'piper'
  })

  // Compute effective voice considering model fallback
  // Priority: chapter override > app language default > global toolbar > auto-select
  let readerVoice = $derived.by(() => {
    // 1. Explicit chapter voice override
    if (currentChapter?.voice) {
      return currentChapter.voice
    }

    // 2. App-level language default
    const langDefault = $appSettings.languageDefaults[readerLanguage]
    if (langDefault?.voice) {
      return langDefault.voice
    }

    // 3. No chapter/app override - check if using global settings
    const baseModel = currentChapter?.model || langDefault?.model || $selectedModel
    if (readerModel === baseModel && baseModel === $selectedModel) {
      // Model didn't change due to fallback, use global voice
      return $selectedVoice
    }

    // 4. Model changed due to language fallback - need to pick appropriate voice
    if (readerModel === 'piper') {
      return selectPiperVoiceForLanguage(readerLanguage, $piperVoices)
    }
    if (readerModel === 'kokoro') {
      return 'af_heart' // Default Kokoro voice
    }

    return $selectedVoice
  })

  // Voice Loading Logic (Centralized)
  let kokoroVoices = listKokoroVoices()

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
      loadPiperVoices().then((raw) => {
        if ($selectedModel === 'piper') {
          const voices = raw.map((v) => ({
            id: v.key,
            label: `${v.name} (${v.language}) - ${v.quality}`,
          }))
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
  async function onBookLoaded(detail: {
    book: Book
    sourceFile?: File
    sourceUrl?: string
    fromLibrary?: boolean
    libraryId?: number
  }) {
    const b = detail.book
    if (b) {
      book.set(b) // Store handles state reset

      let detectedBook: Book = b

      if (detail.libraryId) {
        currentLibraryBookId.set(detail.libraryId)
        location.hash = buildBookHash(detail.libraryId, b)
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

          // Run language detection before auto-generation so the correct
          // language/voice is used from the start.
          try {
            const { detectAndPersistLanguagesForBook } =
              await import('./lib/services/languageDetectionService')
            await detectAndPersistLanguagesForBook(id, b)
            // Reload the book to get detected languages into the in-memory object
            try {
              const { getBook } = await import('./lib/libraryDB')
              const updatedBook = await getBook(id)
              if (updatedBook) {
                book.set(updatedBook)
                detectedBook = updatedBook
              }
            } catch (reloadError) {
              console.warn('Failed to reload book after language detection:', reloadError)
            }
          } catch (detectionError) {
            console.warn('Language detection failed, continuing with defaults:', detectionError)
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
      if (!detail.fromLibrary && detectedBook.chapters?.length > 0) {
        // Select all chapters and start generation
        selectedChapters.update((m) => {
          const newMap = new Map(m)
          detectedBook.chapters.forEach((c: Chapter) => newMap.set(c.id, true))
          return newMap
        })
        const { toastStore } = await import('./stores/toastStore')
        toastStore.info(`Generating audio for ${detectedBook.chapters.length} chapter(s)...`)
        generationService.generateChapters(detectedBook.chapters).catch((err) => {
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
  <ToastContainer />

  {#if currentView === 'landing'}
    <div in:fade class="view-wrapper scrollable">
      <LandingPage onbookloaded={onBookLoaded} onopensettings={() => (currentView = 'settings')} />
    </div>
  {:else if currentView === 'settings'}
    <div in:fade class="view-wrapper scrollable">
      <SettingsPage onBack={() => (currentView = 'landing')} />
    </div>
  {:else if currentView === 'book'}
    <div in:fade class="view-wrapper">
      <button class="back-link" onclick={() => (currentView = 'landing')}>← Library</button>
      <BookView onread={(e) => navigateToReader(e.chapter)} />
    </div>
  {:else if currentView === 'reader' && currentChapter}
    <div in:fade class="view-wrapper full-height">
      <!-- Reader mode toggle -->
      <div class="reader-mode-toggle">
        <button
          class="mode-btn"
          class:active={readerMode === 'single'}
          onclick={() => {
            readerMode = 'single'
            try {
              localStorage.setItem('reader_mode', 'single')
            } catch {
              // localStorage unavailable
            }
          }}
          aria-label="Single chapter view">Chapter</button
        >
        <button
          class="mode-btn"
          class:active={readerMode === 'continuous'}
          onclick={() => {
            readerMode = 'continuous'
            try {
              localStorage.setItem('reader_mode', 'continuous')
            } catch {
              // localStorage unavailable
            }
          }}
          aria-label="Continuous scroll view">Scroll</button
        >
      </div>

      {#if readerMode === 'continuous' && $book}
        <ContinuousReader
          chapters={$book.chapters}
          bookId={$currentLibraryBookId}
          bookTitle={$book.title}
          book={$book}
          voice={readerVoice}
          quantization={$selectedQuantization}
          device={$selectedDevice}
          selectedModel={readerModel}
          initialChapterId={currentChapter.id}
          onBack={handleBackFromReader}
        />
      {:else}
        <TextReader
          chapter={currentChapter}
          bookId={$currentLibraryBookId}
          bookTitle={$book?.title ?? ''}
          voice={readerVoice}
          quantization={$selectedQuantization}
          device={$selectedDevice}
          selectedModel={readerModel}
          chapters={$book?.chapters ?? []}
          onBack={handleBackFromReader}
        />
      {/if}
    </div>
  {/if}
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0;
    height: 100vh;
    height: 100dvh; /* Dynamic viewport height for mobile browsers */
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    min-height: 0;
    overflow: hidden; /* Children manage their own scroll */
  }

  .view-wrapper.scrollable {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
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

  @media (max-width: 768px) {
    .view-wrapper {
      padding: 12px;
      gap: 8px;
    }
  }

  .reader-mode-toggle {
    position: absolute;
    top: 10px;
    right: 16px;
    z-index: 20;
    display: flex;
    gap: 0;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  }

  .mode-btn {
    padding: 4px 12px;
    font-size: 0.75rem;
    border: none;
    background: var(--surface-color, #2a2a2a);
    color: var(--secondary-text, #a0a0a0);
    cursor: pointer;
    transition: all 0.15s;
    font-weight: 500;
  }

  .mode-btn.active {
    background: var(--active-bg, rgba(59, 130, 246, 0.2));
    color: var(--text-color, #e0e0e0);
    font-weight: 600;
  }

  .mode-btn:hover:not(.active) {
    background: var(--hover-bg, rgba(255, 255, 255, 0.05));
  }
</style>
