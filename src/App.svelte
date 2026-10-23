<script lang="ts">
  import { onMount, untrack } from 'svelte'

  // Revamp shell: one reading surface (option A) with its overlays — library,
  // import, per-chapter settings, export, activity and app settings live inside
  // ReaderShell. This file owns deep links, the library list and app chrome.
  import ReaderShell from './ui/ReaderShell.svelte'
  import Toast from './components/Toast.svelte'
  import ToastContainer from './components/ToastContainer.svelte'
  import ReloadPrompt from './components/ReloadPrompt.svelte'
  import ModelLoadingIndicator from './components/ModelLoadingIndicator.svelte'
  import ErrorBoundary from './components/ErrorBoundary.svelte'

  import { book as bookStore } from './stores/bookStore'
  import { currentLibraryBookId } from './stores/libraryStore'
  import { appTheme as theme } from './stores/themeStore'
  import { piperVoices, loadPiperVoices } from './stores/piperVoicesStore'
  import { openBook } from './lib/services/bookSession'
  import { getAllBooksMetadata, getBook, type LibraryBook } from './lib/libraryDB'
  import { shellViewFromHash, buildBookHash, buildReaderHash } from './lib/utils/hashRoutes'
  import { listVoices as listKokoroVoices } from './lib/kokoro/kokoroVoices'
  import {
    availableVoices,
    lastKokoroVoice,
    lastPiperVoice,
    selectedModel,
    selectedVoice,
  } from './stores/ttsStore'
  import { POCKET_VOICES } from './lib/utils/voiceSelector'
  import { POCKET_VOICE_LABELS } from './lib/pocket/pocketAssets'
  import logger from './lib/utils/logger'

  let libraryBooks = $state<LibraryBook[]>([])
  let initialChapterId = $state<string | null>(null)
  let initialOverlay = $state<'library' | 'settings' | null>(null)

  // ---- deep links: restore book/chapter/overlay from the hash ----
  async function applyHash() {
    const view = shellViewFromHash(location.hash)
    if (!view) return

    if (view.kind === 'settings') {
      initialOverlay = 'settings'
      return
    }
    if (view.kind === 'library') {
      initialOverlay = 'library'
      return
    }
    if (view.kind === 'activity') return // ReaderShell opens its own pages

    // reader and audiobook pages both restore the book
    const bookId = view.bookId
    const chapterId = view.kind === 'reader' ? view.chapterId : null
    initialChapterId = untrack(() => chapterId)
    if (bookId === 'unsaved') return
    const book = await openBook(bookId)
    if (book) {
      bookStore.set(book)
      currentLibraryBookId.set(bookId)
    }
  }

  async function refreshLibrary() {
    const meta = await getAllBooksMetadata()
    const recent = [...meta].sort((a, b) => b.lastAccessed - a.lastAccessed)
    libraryBooks = (await Promise.all(recent.map((m) => getBook(m.id)))).filter(
      (b): b is LibraryBook => b != null
    )
  }

  // ---- voice availability for pickers (real catalogues where they ship) ----
  $effect(() => {
    const model = $selectedModel
    if (model === 'web_speech') return

    if (model === 'piper') {
      availableVoices.set([])
      loadPiperVoices().then((raw) => {
        if ($selectedModel !== 'piper') return
        const voices = raw.map((v) => ({ id: v.key, label: `${v.name} (${v.language})` }))
        availableVoices.set(voices)
        untrack(() => {
          const last = $lastPiperVoice
          if (voices.some((v) => v.id === last)) selectedVoice.set(last)
          else if (voices.length > 0) selectedVoice.set(voices[0].id)
        })
      })
      return
    }

    if (model === 'pocket') {
      availableVoices.set(
        POCKET_VOICES.map((v) => ({
          id: v,
          label: POCKET_VOICE_LABELS[v as keyof typeof POCKET_VOICE_LABELS] || v,
        }))
      )
      untrack(() => {
        if (!POCKET_VOICES.includes($selectedVoice as never)) selectedVoice.set(POCKET_VOICES[0])
      })
      return
    }

    const kokoroVoices = listKokoroVoices()
    availableVoices.set(kokoroVoices.map((v) => ({ id: v, label: v })))
    untrack(() => {
      if (kokoroVoices.includes($lastKokoroVoice as never)) selectedVoice.set($lastKokoroVoice)
    })
  })

  // ---- theme ----
  $effect(() => {
    document.documentElement.setAttribute('data-theme', $theme)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor)
      metaThemeColor.setAttribute('content', $theme === 'dark' ? '#0f172a' : '#ffffff')
  })

  onMount(() => {
    loadPiperVoices()
    const start = async () => {
      await refreshLibrary().catch((e) => logger.warn('Failed to load library', e))
      // No deep link means the app was opened fresh (a phone home screen, a
      // closed tab): open where the reader left off instead of showing the
      // empty state on top of a full library.
      const view = shellViewFromHash(location.hash)
      const linked = view && 'bookId' in view ? view.bookId : null
      if ((linked == null || linked === 'unsaved') && libraryBooks[0]?.id != null) {
        const recent = await openBook(libraryBooks[0].id)
        if (recent) {
          bookStore.set(recent)
          currentLibraryBookId.set(libraryBooks[0].id!)
        }
      }
      await applyHash().catch((e) => logger.warn('Failed to restore hash', e))
    }
    void start()
    window.addEventListener('hashchange', () => applyHash().catch(() => {}))
  })
</script>

<a href="#main-content" class="skip-link">Skip to main content</a>

<main class="app-container" id="main-content">
  <ErrorBoundary>
    <Toast />
    <ReloadPrompt />
    <ToastContainer />
    <ModelLoadingIndicator />
    <ReaderShell
      books={libraryBooks}
      {initialChapterId}
      {initialOverlay}
      onLibraryChanged={() => void refreshLibrary()}
    />
  </ErrorBoundary>
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
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
