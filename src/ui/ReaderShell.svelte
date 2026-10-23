<script lang="ts">
  // Reader "Vanish": the whole book is one continuous scroll and the chrome
  // disappears while you read. Tap the page to bring it back. Spoken sentences
  // highlight and follow the voice; generated/pending text is visible in the
  // page itself (dim = no audio yet).
  import type { Book } from '../lib/types/book'
  import type { LibraryBook } from '../lib/libraryDB'
  import { segmentHtmlContent } from '../lib/services/segmentationService'
  import {
    applySegmentState,
    findSegmentElement,
    highlightActiveSegment,
    scrollSegmentIntoView,
    segmentIndexFromEvent,
  } from '../lib/reader/readerSegments'
  import {
    bookProgressOf,
    chapterEstimateSeconds,
    nextChapterFor,
    resumePoint,
    type ChapterAudioView,
  } from '../lib/reader/readerViewState'
  import { loadPosition, savePosition } from '../stores/readerPositionStore'
  import {
    bindLockScreenControls,
    keepScreenAwake,
    setNowPlaying,
  } from '../lib/services/lockScreen'
  import { reader } from './readerModel.svelte'
  import { toastStore } from '../stores/toastStore'
  import { onMount } from 'svelte'
  import {
    ACTIVITY_HASH,
    LIBRARY_HASH,
    buildAudiobookHash,
    buildBookHash,
    buildReaderHash,
    shellViewFromHash,
  } from '../lib/utils/hashRoutes'
  import AudiobookPage from './AudiobookPage.svelte'
  import { importBook, openBook, removeBook } from '../lib/services/bookSession'
  import {
    book as bookStore,
    chapterErrors,
    chapterStatus,
    isGenerating,
  } from '../stores/bookStore'
  import { currentLibraryBookId } from '../stores/libraryStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import {
    selectedDevice,
    selectedModel,
    selectedQuantization,
    selectedVoice,
  } from '../stores/ttsStore'
  import { piperVoices } from '../stores/piperVoicesStore'
  import { MODEL_OPTIONS, voiceOptionsFor } from '../lib/tts/ttsModels'
  import { EXPORT_FORMATS } from '../lib/exportFormats'
  import BooksOverlay from './BooksOverlay.svelte'
  import ImportPanel from './ImportPanel.svelte'
  import AppSettings from './AppSettings.svelte'
  import BookDetail from './BookDetail.svelte'
  import ExportSheet from './ExportSheet.svelte'
  import QueueCenter from './QueueCenter.svelte'
  import Onboarding from './Onboarding.svelte'
  import VoiceSandbox from './VoiceSandbox.svelte'

  let {
    books,
    initialChapterId = null,
    initialOverlay = null,
    onLibraryChanged,
  }: {
    books: LibraryBook[]
    initialChapterId?: string | null
    initialOverlay?: 'library' | 'settings' | null
    /** App owns the library list; call it after imports and deletes. */
    onLibraryChanged?: () => void
  } = $props()

  const THEMES = ['light', 'sepia', 'dark'] as const

  let theme = $state<(typeof THEMES)[number]>('light')
  let fontSize = $state(17) // px, stepped with A− / A+ like variant C
  let chromeVisible = $state(true)
  let tocOpen = $state(false)
  let settingsOpen = $state(false)
  let appSettingsOpen = $state(false)
  let booksOpen = $state(false)
  let importOpen = $state(false)
  let queueOpen = $state(false)
  let tourOpen = $state(false)
  let sandboxOpen = $state(false)
  let detailBook = $state<LibraryBook | null>(null)
  let exportBook = $state<LibraryBook | null>(null)
  let audiobookBook = $state<LibraryBook | null>(null)

  // ---- the address bar mirrors the page, so refresh keeps you where you are ----
  function hashForState(): string {
    const b = reader.book
    const id = reader.bookId ?? 'unsaved'
    if (audiobookBook?.id != null) return buildAudiobookHash(audiobookBook.id, audiobookBook)
    if (appSettingsOpen) return '#/settings'
    if (queueOpen) return ACTIVITY_HASH
    if (booksOpen) return LIBRARY_HASH
    if (importOpen || !b) return '#/'
    const chapter = b.chapters[ui.chapterIndex]
    return chapter ? buildReaderHash(id, chapter.id, b) : buildBookHash(id, b)
  }

  $effect(() => {
    // $currentLibraryBookId is the tracked anchor; the rest is read in the call
    void $currentLibraryBookId
    const hash = hashForState()
    if (location.hash !== hash) history.replaceState(null, '', hash)
  })

  /** External navigation (refresh, back, pasted link) puts the page back. */
  function applyRoute() {
    const view = shellViewFromHash(location.hash)
    if (!view) return
    booksOpen = view.kind === 'library'
    appSettingsOpen = view.kind === 'settings'
    queueOpen = view.kind === 'activity'
    if (view.kind === 'audiobook') {
      const target = books.find((b) => b.id === view.bookId) ?? null
      audiobookBook = target
      if (target?.id != null && target.id !== reader.bookId) void switchTo(target.id)
    } else {
      audiobookBook = null
    }
    if (
      view.kind === 'reader' &&
      typeof view.bookId === 'number' &&
      view.bookId !== reader.bookId
    ) {
      void switchTo(view.bookId)
    }
  }

  onMount(() => {
    applyRoute()
    const onHash = () => applyRoute()
    const goOnline = () => (online = true)
    const goOffline = () => (online = false)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Lock screen / notification controls, bound once.
    bindLockScreenControls({
      play: () => reader.toggle(),
      pause: () => reader.toggle(),
      seekBack: () => reader.skip(-15),
      seekForward: () => reader.skip(15),
      next: () => {
        const next = nextChapterFor(book?.chapters ?? [], playback.chapterId ?? '', true)
        if (next) void reader.play(next)
      },
      previous: () => {
        const chapters = book?.chapters ?? []
        const index = chapters.findIndex((c) => c.id === playback.chapterId)
        const previous = index > 0 ? chapters[index - 1] : null
        if (previous) void reader.play(previous)
      },
    })

    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  })

  // Now playing + keep the screen on while audio runs.
  $effect(() => {
    const playing = playback.playing
    const title = book?.title ?? ''
    const chapter = book?.chapters.find((c) => c.id === playback.chapterId)?.title ?? ''
    if (title) setNowPlaying({ title, chapter }, playing)
    void keepScreenAwake(playing)
  })
  let dragging = $state(false)
  let detached = $state(false) // reader scrolled away from the narration

  // The store behind reader.book. readerModel reads its stores with get(),
  // which Svelte cannot track, so the live mirrors below read the same stores:
  // referencing a mirror is what makes its reader.* views refresh here.
  let book = $derived($bookStore)
  let livePlayer = $derived($audioPlayerStore) // chapterId / playing / position / duration
  let liveGeneration = $derived($segmentProgress) // statusOf / segmentStateOf / bookGeneration
  let liveStatus = $derived($chapterStatus) // statusOf
  let liveErrors = $derived($chapterErrors) // statusOf + the error strip

  // reading position in the scroll; overlays see it as `ui`
  let ui = $state({ bookIndex: 0, chapterIndex: 0, progress: 0 })
  let chIds = $derived((book?.chapters ?? []).map((c) => c.id))
  let wrapped = $derived((book?.chapters ?? []).map((c) => segmentHtmlContent(c.id, c.content)))
  let scroller: HTMLElement | undefined = $state()
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let lastScrollTop = 0

  function poke() {
    chromeVisible = true
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!tocOpen && !settingsOpen && !booksOpen && !importOpen) chromeVisible = false
    }, 2500)
  }

  function onScroll() {
    const el = scroller!
    const max = el.scrollHeight - el.clientHeight
    ui.progress = max > 0 ? el.scrollTop / max : 0

    // Track the chapter whose heading is closest above the reading line
    const top = el.getBoundingClientRect().top
    const marks = el.querySelectorAll<HTMLElement>('[data-chapter]')
    let idx = 0
    marks.forEach((m, i) => {
      if (m.getBoundingClientRect().top <= top + 140) idx = i
    })
    ui.chapterIndex = idx

    if (el.scrollTop > lastScrollTop + 4) chromeVisible = false
    else if (el.scrollTop < lastScrollTop - 4) poke()
    lastScrollTop = el.scrollTop

    // Remember where the reader is, at most every few seconds.
    const now = Date.now()
    if (now - lastSavedAt > 3000) {
      lastSavedAt = now
      saveCurrentPosition()
    }

    // Eleven-style: scrolling never moves the narration, it only detaches the
    // view; a button offers the return trip.
    if (Date.now() < programmaticUntil) return
    if (reader.chapterId == null) detached = false
    else {
      const seg = spokenSegmentEl()
      detached = seg ? outsideBand(seg, el) : true
    }
  }

  /** The element of the sentence being spoken, when it exists. */
  function spokenSegmentEl(): HTMLElement | null {
    const root = scroller
    if (!root || reader.chapterId == null) return null
    const ci = (book?.chapters ?? []).findIndex((c) => c.id === reader.chapterId)
    const section = ci >= 0 ? root.querySelector(`[data-section="${ci}"]`) : null
    return section ? findSegmentElement(reader.segmentIndex, section) : null
  }

  function outsideBand(el: HTMLElement, root: HTMLElement): boolean {
    const r = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return r.top < b.top + 90 || r.bottom > b.bottom - 130
  }

  // smooth scrolls we start ourselves must not count as "the reader scrolled
  // away", or the detach check races its own animation
  let programmaticUntil = 0
  function markProgrammatic() {
    programmaticUntil = Date.now() + 800
  }

  function backToNarration() {
    detached = false
    markProgrammatic()
    const root = scroller
    const seg = spokenSegmentEl()
    if (!root || !seg) return
    const r = root.getBoundingClientRect()
    // instant snap: the reader teleports back, no long smooth ride
    scrollSegmentIntoView(seg, { top: r.top + 90, bottom: r.bottom - 130, behavior: 'auto' })
  }

  /** Click a sentence to continue from there; a text selection is left alone. */
  function onReaderClick(e: MouseEvent) {
    const idx = segmentIndexFromEvent(e)
    const section = (e.target as HTMLElement | null)?.closest?.('[data-section]')
    if (idx != null && section) {
      if (window.getSelection()?.toString()) return // user is selecting text
      const ci = Number(section.getAttribute('data-section'))
      const ch = book?.chapters[ci]
      if (ch) {
        void reader.playFromSegment(ch, idx)
        poke()
        return
      }
    }
    chromeVisible ? (chromeVisible = false) : poke()
  }

  function openToc() {
    tocOpen = true
    chromeVisible = true
    clearTimeout(hideTimer)
  }

  function goToChapter(i: number) {
    tocOpen = false
    ui.chapterIndex = i
    scroller
      ?.querySelector(`[data-chapter="${i}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    poke()
  }

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    poke()
  }

  // ---- audiobook generation / playback (real pipeline via readerModel) ----
  // one snapshot of the player; reading the mirror first keeps it live
  let playback = $derived.by(() => {
    livePlayer
    return {
      chapterId: reader.chapterId,
      playing: reader.playing,
      position: reader.position,
      duration: reader.duration,
    }
  })

  let playingThis = $derived(
    playback.chapterId === book?.chapters[ui.chapterIndex]?.id && playback.playing
  )

  // Offline is a state the reader wears openly: generated audio keeps playing.
  let online = $state(typeof navigator === 'undefined' || navigator.onLine)

  // Position in the book as a whole, not just the chapter being played: the
  // chapters before it plus the share of it already played.
  let listen = $derived.by(() => {
    const chapters = book?.chapters ?? []
    const index = chapters.findIndex((c) => c.id === playback.chapterId)
    return bookProgressOf(
      chapters.map((c) => chapterEstimateSeconds(c.content)),
      index,
      playback.duration > 0 ? playback.position / playback.duration : 0
    )
  })

  // Listening carries into the next chapter when a chapter runs out.
  // shortcut: the store exposes no end-of-chapter event, so paused-at-end is
  // the signal; upgrade when playback emits one.
  let continuedFrom = ''
  $effect(() => {
    const finished = playback.chapterId
    const ended =
      !playback.playing &&
      finished != null &&
      playback.duration > 0 &&
      playback.position >= playback.duration - 0.6
    if (!ended || finished === continuedFrom) return
    if (!reader.prefs.autoContinue || !book) return
    continuedFrom = finished
    const next = nextChapterFor(book.chapters, finished, true)
    if (next) void reader.play(next)
  })

  function playCurrent() {
    const ch = book?.chapters[ui.chapterIndex]
    if (!ch) {
      toastStore.warning('This book has no readable chapters yet')
      return
    }
    if (reader.chapterId === ch.id) reader.toggle()
    else void reader.play(ch)
    poke()
  }

  function fmt(s: number) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  // ---- transport conveniences: speed, sleep timer ----
  const SPEEDS = [1, 1.25, 1.5, 2]

  function cycleSpeed() {
    const current = reader.prefs.rate
    reader.prefs.rate = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length] ?? 1
    toastStore.info(`Speed ${reader.prefs.rate}×`)
  }

  let sleepMinutes = $state(0)
  let sleepTimer: ReturnType<typeof setTimeout> | undefined

  function cycleSleep() {
    clearTimeout(sleepTimer)
    const steps = [0, 15, 30, 60]
    sleepMinutes = steps[(steps.indexOf(sleepMinutes) + 1) % steps.length] ?? 0
    if (sleepMinutes > 0) {
      sleepTimer = setTimeout(() => {
        reader.stop()
        sleepMinutes = 0
        toastStore.info('Sleep timer finished — playback stopped')
      }, sleepMinutes * 60_000)
      toastStore.info(`Sleep timer set for ${sleepMinutes} minutes`)
    }
  }

  /** What one chapter's audio looks like, re-read so generation moves it. */
  function chapterView(id: string): ChapterAudioView {
    liveGeneration
    liveStatus
    liveErrors
    return reader.statusOf(id)
  }

  function chapterBadge(id: string): string {
    const e = chapterView(id)
    if (e.state === 'ready') return '♪'
    if (e.state === 'generating') return `${Math.round(e.progress * 100)}%`
    if (e.state === 'failed') return '⚠'
    return '○'
  }

  // voices for the language of the chapter in view (no global language pref)
  let chapterLang = $derived(book?.chapters[ui.chapterIndex]?.language ?? book?.language ?? 'en')
  let voiceChoices = $derived(voiceOptionsFor($selectedModel, chapterLang, $piperVoices))

  // ---- error surface (real failures, from the generation stores) ----
  let firstError = $derived.by(() => {
    const entry = $chapterErrors.entries().next().value
    return entry as [string, string] | undefined
  })

  function retryErrors() {
    void reader.retry([...$chapterErrors.keys()])
  }

  function dismissError() {
    const key = firstError?.[0]
    if (key == null) return
    chapterErrors.update((map) => {
      const next = new Map(map)
      next.delete(key)
      return next
    })
  }

  // Overall generation progress over the whole book's text.
  let counts = $derived.by(() => {
    liveGeneration
    liveStatus
    liveErrors
    return {
      ready: reader.readyCount(chIds),
      generating: reader.generatingCount(chIds),
      failed: reader.failedCount(chIds),
    }
  })
  let genPct = $derived.by(() => {
    liveGeneration
    return reader.bookGeneration.percent
  })

  // scroll to the chapter the app asked for, once it is on the page
  // svelte-ignore state_referenced_locally -- the id is read once, on mount
  let pendingChapter = $state(initialChapterId)
  if (initialOverlay === 'settings') settingsOpen = true
  if (initialOverlay === 'library') booksOpen = true
  $effect(() => {
    if (!pendingChapter || !book || !scroller) return
    const i = book.chapters.findIndex((c) => c.id === pendingChapter)
    if (i < 0) return
    pendingChapter = null
    goToChapter(i)
  })

  // keep the overlays' book index on the book actually open
  $effect(() => {
    const i = books.findIndex((b) => b.id != null && b.id === $currentLibraryBookId)
    if (i >= 0) ui.bookIndex = i
  })

  // ---- library: open / listen / delete / import (real libraryDB) ----
  async function switchTo(libraryId: number) {
    const b = await openBook(libraryId)
    if (!b) return
    bookStore.set(b)
    currentLibraryBookId.set(libraryId)
    ui.chapterIndex = 0
    ui.progress = 0
    scroller?.scrollTo({ top: 0 })
    restorePosition()
  }

  // ---- where the reader left off ----
  let lastSavedAt = 0

  function saveCurrentPosition() {
    const chapter = book?.chapters[ui.chapterIndex]
    if (!chapter) return
    const previous = loadPosition(reader.bookId)
    savePosition(reader.bookId, {
      chapterId: chapter.id,
      segmentIndex:
        reader.chapterId === chapter.id && reader.segmentIndex >= 0
          ? reader.segmentIndex
          : (previous?.segmentIndex ?? 0),
      scrollFraction: ui.progress,
      savedAt: Date.now(),
    })
  }

  function restorePosition() {
    const saved = loadPosition(reader.bookId)
    const at = resumePoint(
      saved ? { chapterId: saved.chapterId, segmentIndex: saved.segmentIndex } : null,
      book?.chapters ?? []
    )
    if (!at) return
    ui.chapterIndex = at.chapterIndex
    ui.progress = saved?.scrollFraction ?? 0
    requestAnimationFrame(() => {
      const el = scroller
      if (!el) return
      el.scrollTop = ui.progress * (el.scrollHeight - el.clientHeight)
    })
  }

  function openLibraryBook(i: number) {
    const id = books[i]?.id
    if (id == null) return
    void switchTo(id)
    booksOpen = false
  }

  function listenLibraryBook(i: number) {
    const lb = books[i]
    if (lb?.id == null) return
    void switchTo(lb.id).then(() => {
      const first = reader.book?.chapters[0]
      if (first) void reader.play(first)
    })
    booksOpen = false
  }

  async function removeLibraryBook(libraryId: number) {
    await removeBook(libraryId)
    onLibraryChanged?.()
    if (libraryId !== reader.bookId) return
    const next = books.find((b) => b.id != null && b.id !== libraryId)
    if (next?.id != null) {
      await switchTo(next.id)
    } else {
      bookStore.set(null)
      currentLibraryBookId.set(null)
      ui.chapterIndex = 0
      ui.progress = 0
      scroller?.scrollTo({ top: 0 })
    }
  }

  function deleteLibraryBook(i: number) {
    const id = books[i]?.id
    if (id != null) void removeLibraryBook(id)
  }

  /** The audiobook page manages one book's audio: make it current, then show it. */
  async function openAudiobookPage(i: number) {
    const lb = books[i]
    if (!lb) return
    if (lb.id != null && lb.id !== reader.bookId) await switchTo(lb.id)
    audiobookBook = lb
    booksOpen = false
  }

  /** Generation runs on the book in the current session — open it first. */
  async function generateFor(b: Book) {
    const lb = b as LibraryBook
    if (lb.id != null && lb.id !== reader.bookId) await switchTo(lb.id)
    void reader.generate(b.chapters.map((c) => c.id))
  }

  /** Export runs on the book in the current session too — open it first. */
  async function exportFor(b: Book) {
    const lb = b as LibraryBook
    if (lb.id != null && lb.id !== reader.bookId) await switchTo(lb.id)
    detailBook = null
    exportBook = b as LibraryBook
  }

  function openImportedBook(b: Book) {
    // ImportPanel hands over the imported book (a LibraryBook once saved)
    const lb = b as LibraryBook
    bookStore.set(b)
    currentLibraryBookId.set(lb.id ?? null)
    ui.chapterIndex = 0
    ui.progress = 0
    booksOpen = false
    importOpen = false
    scroller?.scrollTo({ top: 0 })
    restorePosition()
    onLibraryChanged?.()
  }

  function onDropAnywhere(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    importBook({ file: f })
      .then(openImportedBook)
      .catch((err) => console.warn('import failed', err))
  }

  // ---- spoken-segment highlight (real segment spans from segmentationService) ----
  let lastSpoke = ''
  $effect(() => {
    const chId = playback.chapterId
    const idx = reader.segmentIndex
    const root = scroller
    if (!root) return
    // only touch the DOM when the spoken segment changes: re-adding .active on
    // every playback tick would restart its background transition forever
    const key = chId == null || idx < 0 ? 'none' : `${chId}:${idx}`
    if (key === lastSpoke) return
    lastSpoke = key
    if (chId == null || idx < 0) {
      highlightActiveSegment(-1, root)
      detached = false
      return
    }
    const ci = (book?.chapters ?? []).findIndex((c) => c.id === chId)
    const section = ci >= 0 ? root.querySelector(`[data-section="${ci}"]`) : null
    highlightActiveSegment(idx, section)
    const el = section && findSegmentElement(idx, section)
    // Eleven-style: keep the narration in view only while the reader is with
    // it; once detached, never yank the page back. Detach state flips only on
    // real user scrolls (see onScroll), never on our own follow-scrolls.
    if (el && !detached) {
      markProgrammatic()
      const r = root.getBoundingClientRect()
      scrollSegmentIntoView(el, { top: r.top + 90, bottom: r.bottom - 130 })
    }
  })

  // ---- generation state in the text: dim = pending, full = generated ----
  const appliedGen: Record<string, (string | undefined)[]> = {}
  $effect(() => {
    const root = scroller
    liveGeneration // reader.segmentStateOf reads the store with get()
    if (!root) return
    ;(book?.chapters ?? []).forEach((c, ci) => {
      const n = wrapped[ci]?.segments.length ?? 0
      const section = root.querySelector(`[data-section="${ci}"]`)
      if (!section) return
      const prev = (appliedGen[c.id] ??= new Array(n))
      for (let i = 0; i < n; i++) {
        const st = reader.segmentStateOf(c.id, i)
        if (prev[i] === st) continue // keep the generating pulse from restarting
        prev[i] = st
        const el = findSegmentElement(i, section)
        if (el) applySegmentState(el, st)
      }
    })
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="vanish theme-{theme}"
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={(e) => {
    if (e.target === e.currentTarget) dragging = false
  }}
  ondrop={onDropAnywhere}
>
  {#if book && books.length > 0}
    <div
      class="reader"
      bind:this={scroller}
      onscroll={onScroll}
      onclick={onReaderClick}
      role="presentation"
      aria-label="Book content"
    >
      <div class="column" style="font-size: {fontSize}px">
        {#each book.chapters as chapter, i (chapter.id)}
          <section class="chapter" data-section={i}>
            <h2 class="chapter-mark" data-chapter={i}>{chapter.title}</h2>
            {@html wrapped[i].html}
          </section>
        {/each}
        <p class="the-end">· · ·</p>
      </div>
    </div>

    {#if chromeVisible}
      <header class="topbar">
        <button class="icon" onclick={openToc} aria-label="Table of contents">☰</button>
        <button class="title" onclick={() => (booksOpen = true)} aria-label="Books">
          <span class="book-title">{book.title} ▾</span>
          <span class="chapter-title">{book.chapters[ui.chapterIndex]?.title}</span>
        </button>
        {#if !online}
          <span class="offline-chip" title="Generated audio keeps playing offline">Offline</span>
        {/if}
        <button class="icon" onclick={playCurrent} aria-label="Listen to this chapter"
          >{playingThis ? '❚❚' : '▶'}</button
        >
        <button
          class="icon"
          onclick={() => {
            fontSize = Math.max(14, fontSize - 1)
            poke()
          }}
          aria-label="Smaller text">A−</button
        >
        <button
          class="icon"
          onclick={() => {
            fontSize = Math.min(24, fontSize + 1)
            poke()
          }}
          aria-label="Larger text">A+</button
        >
        <button
          class="icon"
          onclick={() => {
            settingsOpen = true
            chromeVisible = true
            clearTimeout(hideTimer)
          }}
          aria-label="Settings">Aa</button
        >
        <button class="icon" onclick={cycleTheme} aria-label="Theme"
          >{theme === 'dark' ? '☀' : '☾'}</button
        >
      </header>
    {/if}

    {#if playback.chapterId && detached}
      <!-- Eleven-style: narration keeps going, this is the way back to it -->
      <button class="jump-back" onclick={backToNarration}>↓ Return to narration</button>
    {/if}

    {#if firstError}
      <div class="error-strip" role="alert">
        <span>⚠ {firstError[1]}</span>
        <button class="err-btn" onclick={retryErrors}>Retry</button>
        <button class="err-btn" onclick={dismissError} aria-label="Dismiss">✕</button>
      </div>
    {/if}

    {#if playback.chapterId}
      <!-- audio keeps playing and stays controllable even when reading chrome hides -->
      <div class="transport">
        <button class="icon" onclick={() => reader.toggle()} aria-label="Play or pause"
          >{playback.playing ? '❚❚' : '▶'}</button
        >
        <button class="icon" onclick={() => reader.skip(-15)} aria-label="Back 15 seconds"
          >−15</button
        >
        <button class="icon" onclick={() => reader.skip(15)} aria-label="Forward 15 seconds"
          >+15</button
        >
        <div class="t-meta">
          <span class="t-title"
            >{book.chapters.find((c) => c.id === playback.chapterId)?.title}</span
          >
          <div
            class="t-bar"
            role="presentation"
            onclick={(e) =>
              reader.seekBook(e.offsetX / (e.currentTarget as HTMLElement).clientWidth)}
          >
            <div class="t-fill" style="width: {listen.fraction * 100}%"></div>
          </div>
        </div>
        <span class="t-time">{fmt(listen.position)} / {fmt(listen.duration)}</span>
        <button class="icon" onclick={cycleSpeed} aria-label="Playback speed"
          >{reader.prefs.rate}×</button
        >
        <button class="icon" onclick={cycleSleep} aria-label="Sleep timer"
          >{sleepMinutes > 0 ? `${sleepMinutes}m` : '☾'}</button
        >
        <button class="icon" onclick={() => reader.stop()} aria-label="Close player">✕</button>
      </div>
    {:else if $isGenerating || counts.generating > 0}
      <button class="prep" onclick={() => (queueOpen = true)}>
        <div class="prep-bar"><div class="prep-fill" style="width: {genPct * 100}%"></div></div>
        <span>Preparing audio… {Math.round(genPct * 100)}% · activity</span>
      </button>
    {:else if counts.failed > 0}
      <button class="prep failed" onclick={() => (queueOpen = true)}>
        <span>⚠ {counts.failed} chapter(s) failed · activity</span>
      </button>
    {/if}

    <footer class="progress" class:dim={!chromeVisible}>
      <div class="bar"><div class="fill" style="width: {ui.progress * 100}%"></div></div>
      <span class="pct">{Math.round(ui.progress * 100)}%</span>
    </footer>

    {#if tocOpen}
      <div class="toc-backdrop" onclick={() => (tocOpen = false)} role="presentation"></div>
      <nav class="toc">
        <div class="toc-books">
          {#each books as b, i (b.title)}
            <button
              class="toc-book"
              class:active={i === ui.bookIndex}
              onclick={() => openLibraryBook(i)}>{b.title}</button
            >
          {/each}
          <button class="toc-book" onclick={() => (booksOpen = true)}>All books</button>
          <button class="toc-book import-chip" onclick={() => (importOpen = true)}>＋ Import</button
          >
        </div>
        <ul>
          {#each book.chapters as c, i (c.id)}
            <li>
              <button
                class="toc-item"
                class:current={i === ui.chapterIndex}
                onclick={() => goToChapter(i)}
              >
                {c.title}
                <span
                  class="badge"
                  class:ready={chapterView(c.id).state === 'ready'}
                  class:gen={chapterView(c.id).state === 'generating'}
                  class:failed={chapterView(c.id).state === 'failed'}
                >
                  {chapterBadge(c.id)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </nav>
    {/if}

    {#if settingsOpen}
      <div class="panel-backdrop" onclick={() => (settingsOpen = false)} role="presentation"></div>
      <aside class="settings" role="dialog" aria-label="Settings">
        <header>
          <h3>Settings</h3>
          <button class="icon" onclick={() => (settingsOpen = false)} aria-label="Close">✕</button>
        </header>

        <h4>Reading</h4>
        <label class="field">
          Theme
          <select bind:value={theme}>
            {#each THEMES as t (t)}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Text size
          <input type="range" min="14" max="24" bind:value={fontSize} />
        </label>

        <h4>Text-to-speech</h4>
        <!-- writes go through reader.prefs; the reads use the stores it wraps,
             because its getters are invisible to Svelte -->
        <label class="field">
          Model
          <select
            value={$selectedModel}
            onchange={(e) => {
              reader.prefs.model = e.currentTarget.value
              // the old voice may not exist on the new model
              const first = voiceChoices[0]?.id
              if (first) reader.prefs.voice = first
            }}
          >
            {#each MODEL_OPTIONS as m (m.id)}
              <option value={m.id}>{m.name}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Voice
          <select
            value={$selectedVoice}
            onchange={(e) => (reader.prefs.voice = e.currentTarget.value)}
          >
            {#each voiceChoices as v (v.id)}
              <option value={v.id}>{v.label}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Quantization
          <select
            value={$selectedQuantization}
            onchange={(e) => (reader.prefs.quantization = e.currentTarget.value)}
          >
            <option value="fp32">fp32</option>
            <option value="fp16">fp16</option>
            <option value="q8">q8</option>
          </select>
        </label>
        <label class="field">
          Device
          <select
            value={$selectedDevice}
            onchange={(e) => (reader.prefs.device = e.currentTarget.value)}
          >
            <option value="webgpu">webgpu</option>
            <option value="wasm">wasm</option>
          </select>
        </label>

        <h4>Playback</h4>
        <label class="field">
          Speed
          <select bind:value={reader.prefs.rate}>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>

        <h4>Audiobook</h4>
        <p class="field-note">♪ {counts.ready}/{book.chapters.length} chapters ready</p>
        <button class="action" onclick={() => void reader.generateMissing()}>
          {counts.generating > 0 ? `Generating… ${counts.generating} left` : 'Generate audiobook'}
        </button>
        <label class="field">
          Export format
          <select bind:value={reader.prefs.exportFormat}>
            {#each EXPORT_FORMATS as f (f.value)}
              <option value={f.value}>{f.label}</option>
            {/each}
          </select>
        </label>
        <button class="action" onclick={() => (exportBook = book as LibraryBook)}
          >Export audiobook…</button
        >
        <button
          class="linkish"
          onclick={() => {
            settingsOpen = false
            appSettingsOpen = true
          }}
        >
          App settings →
        </button>
      </aside>
    {/if}
  {:else}
    <!-- first-run / empty library -->
    <div class="empty-state">
      <div class="empty-card">
        <span class="empty-icon" aria-hidden="true">📚</span>
        <h1>Your library is empty</h1>
        <p>Drag a book file anywhere on this screen, or add one to get started.</p>
        <div class="empty-actions">
          <button class="empty-cta" onclick={() => (importOpen = true)}>＋ Add a book</button>
          <button class="empty-link" onclick={() => (tourOpen = true)}>Take the tour</button>
          <button class="empty-link" onclick={() => (booksOpen = true)}>Your books</button>
        </div>
      </div>
    </div>
  {/if}

  {#if booksOpen}
    <BooksOverlay
      {books}
      {ui}
      onOpen={openLibraryBook}
      onListen={listenLibraryBook}
      onDelete={deleteLibraryBook}
      onImport={() => (importOpen = true)}
      onDetails={(i) => {
        detailBook = books[i] ?? null
        booksOpen = false
      }}
      onAudiobook={openAudiobookPage}
      onActivity={() => {
        booksOpen = false
        queueOpen = true
      }}
      onSettings={() => {
        booksOpen = false
        appSettingsOpen = true
      }}
      onClose={() => (booksOpen = false)}
    />
  {/if}

  {#if detailBook}
    <BookDetail
      book={detailBook}
      onClose={() => (detailBook = null)}
      onExport={() => detailBook && void exportFor(detailBook)}
      onGenerate={() => detailBook && generateFor(detailBook)}
      onDelete={() => {
        if (detailBook?.id != null) void removeLibraryBook(detailBook.id)
        detailBook = null
      }}
    />
  {/if}

  {#if exportBook}
    <ExportSheet book={exportBook} onClose={() => (exportBook = null)} />
  {/if}

  {#if audiobookBook}
    <AudiobookPage
      book={audiobookBook}
      onClose={() => (audiobookBook = null)}
      onExport={() => (exportBook = audiobookBook)}
    />
  {/if}

  {#if queueOpen}
    <QueueCenter {books} onClose={() => (queueOpen = false)} />
  {/if}

  {#if tourOpen}
    <Onboarding
      onImport={() => {
        tourOpen = false
        importOpen = true
      }}
      onDemo={() => (tourOpen = false)}
      onClose={() => (tourOpen = false)}
    />
  {/if}

  {#if sandboxOpen}
    <VoiceSandbox onClose={() => (sandboxOpen = false)} />
  {/if}

  {#if importOpen}
    <ImportPanel onImported={openImportedBook} onClose={() => (importOpen = false)} />
  {/if}

  {#if appSettingsOpen}
    <AppSettings
      bookCount={books.length}
      onTour={() => {
        appSettingsOpen = false
        tourOpen = true
      }}
      onSandbox={() => {
        appSettingsOpen = false
        sandboxOpen = true
      }}
      onClose={() => (appSettingsOpen = false)}
    />
  {/if}

  {#if dragging}
    <div class="drop-overlay"><span>⤓</span> Drop to add to library</div>
  {/if}
</div>

<style>
  .vanish {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--v-bg);
    color: var(--v-text);
  }

  .theme-light {
    --v-bg: #faf9f7;
    --v-text: #1c1917;
    --v-sub: #78716c;
    --v-bar: #ffffffee;
    --v-line: #e7e5e4;
    --v-accent: #78716c;
    --v-hl: rgba(245, 158, 11, 0.22);
    --v-err: #fdf2f0;
    --v-err-text: #9a5b52;
  }

  .theme-sepia {
    --v-bg: #f4ecd8;
    --v-text: #3d3229;
    --v-sub: #8a7860;
    --v-bar: #f9f3e6ee;
    --v-line: #e0d3b8;
    --v-accent: #8a7860;
    --v-hl: rgba(190, 125, 45, 0.24);
    --v-err: #f7e9e2;
    --v-err-text: #9a5b52;
  }

  .theme-dark {
    --v-bg: #12100e;
    --v-text: #e7e5e4;
    --v-sub: #a8a29e;
    --v-bar: #1c1917ee;
    --v-line: #292524;
    --v-accent: #a8a29e;
    --v-hl: rgba(245, 158, 11, 0.3);
    --v-err: #2a1f1d;
    --v-err-text: #d4a099;
  }

  .reader {
    flex: 1;
    overflow-y: auto;
    cursor: default;
  }

  .column {
    max-width: 40rem;
    margin: 0 auto;
    padding: 5rem 1.5rem 7rem;
  }

  .chapter-mark {
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--v-sub);
    margin: 4.5rem 0 2.2rem;
    text-align: center;
  }

  .chapter:first-child .chapter-mark {
    margin-top: 1rem;
  }

  .column :global(p) {
    margin: 0 0 1.1em;
    line-height: 1.85;
  }

  /* segment states: dim = no audio yet, full = generated, amber = being made */
  .column :global(.segment) {
    border-radius: 4px;
    transition:
      background 0.2s ease,
      opacity 0.3s ease;
    opacity: 0.45;
  }

  /* click a sentence to continue from there */
  .column :global(.segment:hover) {
    cursor: pointer;
    opacity: 1;
  }

  .column :global(.segment.segment-generated) {
    opacity: 1;
  }

  .column :global(.segment.segment-generating) {
    opacity: 0.85;
    background: var(--v-hl);
    animation: gen-pulse 1.6s ease-in-out infinite;
  }

  .column :global(.segment.active) {
    opacity: 1;
    background: var(--v-hl);
  }

  @keyframes gen-pulse {
    0%,
    100% {
      background: var(--v-hl);
    }
    50% {
      background: transparent;
    }
  }

  .the-end {
    text-align: center;
    color: var(--v-sub);
    letter-spacing: 0.5em;
    margin-top: 4rem;
  }

  .topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--v-bar);
    border-bottom: 1px solid var(--v-line);
    backdrop-filter: blur(8px);
  }

  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
  }

  .title:hover {
    background: var(--v-line);
  }

  .book-title {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapter-title {
    font-size: 0.72rem;
    color: var(--v-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .icon {
    background: none;
    border: none;
    color: var(--v-sub);
    font-size: 0.95rem;
    cursor: pointer;
    padding: 8px 10px;
    min-height: 36px;
    border-radius: 8px;
  }

  .icon:hover {
    background: var(--v-line);
    color: var(--v-text);
  }

  .progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
    background: var(--v-bar);
    transition: opacity 0.25s;
  }

  .progress.dim {
    opacity: 0.35;
  }

  .bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--v-line);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--v-accent);
  }

  .pct {
    font-size: 0.72rem;
    color: var(--v-sub);
    font-variant-numeric: tabular-nums;
  }

  /* transport: stays up while audio plays, even when reading chrome hides */
  .transport {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 46px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: var(--v-bar);
    border-top: 1px solid var(--v-line);
  }

  .t-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 8px;
  }

  .t-title {
    font-size: 0.72rem;
    color: var(--v-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .t-bar {
    height: 3px;
    border-radius: 2px;
    background: var(--v-line);
    cursor: pointer;
  }

  .t-fill {
    height: 100%;
    background: var(--v-accent);
    border-radius: 2px;
  }

  .offline-chip {
    font-size: 0.68rem;
    color: var(--v-sub);
    border: 1px solid var(--v-line);
    border-radius: 999px;
    padding: 3px 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .t-time {
    font-size: 0.68rem;
    color: var(--v-sub);
    font-variant-numeric: tabular-nums;
  }

  .prep {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 46px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: var(--v-bar);
    border: none;
    border-top: 1px solid var(--v-line);
    font-size: 0.72rem;
    color: var(--v-sub);
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .prep:hover {
    background: var(--v-line);
  }

  .prep.failed {
    color: var(--v-err-text);
  }

  .error-strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 92px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    background: var(--v-err);
    color: var(--v-err-text);
    border-top: 1px solid var(--v-line);
    font-size: 0.78rem;
    z-index: 14;
  }

  .error-strip span {
    flex: 1;
    min-width: 0;
  }

  .err-btn {
    background: none;
    border: 1px solid currentColor;
    color: inherit;
    border-radius: 8px;
    padding: 5px 10px;
    font-size: 0.74rem;
    cursor: pointer;
    min-height: 30px;
    white-space: nowrap;
  }

  .err-btn:hover {
    background: rgba(128, 128, 128, 0.15);
  }

  .prep-bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--v-line);
    overflow: hidden;
  }

  .prep-fill {
    height: 100%;
    background: var(--v-accent);
    transition: width 0.3s ease;
  }

  .toc-backdrop,
  .panel-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 10;
  }

  .toc {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, 82vw);
    background: var(--v-bar);
    border-left: 1px solid var(--v-line);
    overflow-y: auto;
    padding: 16px 0 4rem;
    z-index: 11;
  }

  .toc-books {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 16px 14px;
    border-bottom: 1px solid var(--v-line);
    margin-bottom: 8px;
  }

  .toc-book {
    background: none;
    border: 1px solid var(--v-line);
    color: var(--v-sub);
    border-radius: 999px;
    font-size: 0.72rem;
    padding: 5px 11px;
    cursor: pointer;
  }

  .toc-book.active {
    background: var(--v-text);
    color: var(--v-bg);
    border-color: var(--v-text);
  }

  .import-chip {
    border-style: dashed;
  }

  .toc ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .toc-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--v-text);
    padding: 11px 20px;
    font-size: 0.88rem;
    cursor: pointer;
  }

  .toc-item:hover {
    background: var(--v-line);
  }

  .toc-item.current {
    color: var(--v-sub);
    font-weight: 600;
  }

  .badge {
    font-size: 0.68rem;
    color: var(--v-sub);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .badge.ready {
    color: var(--v-text);
  }

  .badge.gen {
    color: var(--v-accent);
    font-weight: 600;
  }

  .badge.failed {
    color: var(--v-err-text);
    font-weight: 600;
  }

  /* settings panel (Aa) */
  .settings {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(340px, 90vw);
    z-index: 11;
    background: var(--v-bar);
    border-left: 1px solid var(--v-line);
    overflow-y: auto;
    padding: 18px 18px 3rem;
  }

  .settings header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .settings h3 {
    margin: 0;
    font-size: 1.05rem;
  }

  .settings h4 {
    margin: 18px 0 8px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--v-sub);
    font-weight: 600;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--v-sub);
    margin-bottom: 8px;
  }

  .field select,
  .field input {
    width: 160px;
    background: none;
    border: 1px solid var(--v-line);
    color: var(--v-text);
    border-radius: 8px;
    padding: 8px;
    font-size: 0.8rem;
    min-height: 36px;
  }

  .field-note {
    font-size: 0.78rem;
    color: var(--v-sub);
    margin: 0 0 8px;
  }

  .action {
    width: 100%;
    background: none;
    border: 1px solid var(--v-line);
    color: var(--v-text);
    border-radius: 8px;
    padding: 9px 10px;
    font-size: 0.8rem;
    cursor: pointer;
    min-height: 38px;
    margin-bottom: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action:hover {
    background: var(--v-line);
  }

  /* drag & drop anywhere */
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--v-bg) 82%, transparent);
    border: 3px dashed var(--v-accent);
    border-radius: 12px;
    margin: 12px;
    font-size: 1.15rem;
    color: var(--v-text);
    pointer-events: none;
    flex-direction: column;
    gap: 8px;
  }

  .drop-overlay span {
    font-size: 2.2rem;
    display: block;
    text-align: center;
  }

  /* return to narration (Eleven-style) */
  .jump-back {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 108px;
    z-index: 15;
    background: var(--v-text);
    color: var(--v-bg);
    border: none;
    border-radius: 999px;
    padding: 10px 18px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
  }

  .jump-back:hover {
    opacity: 0.88;
  }

  /* first-run / empty library */
  .empty-state {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .empty-card {
    text-align: center;
    max-width: 380px;
  }

  .empty-icon {
    font-size: 2.6rem;
    display: block;
    margin-bottom: 12px;
  }

  .empty-card h1 {
    margin: 0 0 8px;
    font-size: 1.35rem;
    letter-spacing: -0.01em;
  }

  .empty-card p {
    margin: 0 0 22px;
    color: var(--v-sub);
    font-size: 0.92rem;
    line-height: 1.6;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
  }

  .empty-cta {
    background: var(--v-text);
    color: var(--v-bg);
    border: none;
    border-radius: 12px;
    padding: 12px 22px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }

  .empty-link {
    background: none;
    border: 1px solid var(--v-line);
    color: var(--v-sub);
    border-radius: 12px;
    padding: 12px 18px;
    font-size: 0.88rem;
    cursor: pointer;
    min-height: 44px;
  }

  .empty-link:hover {
    background: var(--v-line);
    color: var(--v-text);
  }

  .linkish {
    background: none;
    border: none;
    color: var(--v-sub);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 6px 2px;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .linkish:hover {
    color: var(--v-text);
  }

  /* compact / mobile */
  @media (max-width: 640px) {
    .topbar {
      padding: 8px;
      gap: 2px;
    }

    .icon {
      padding: 8px 7px;
      font-size: 0.88rem;
    }

    .title {
      padding: 2px 4px;
    }

    .column {
      padding: 4.2rem 1rem 8.5rem;
    }

    .transport {
      gap: 2px;
      padding: 6px 6px;
      bottom: 42px;
    }

    .t-time {
      display: none;
    }

    .prep {
      padding: 8px 10px;
      bottom: 42px;
    }

    .error-strip {
      bottom: 88px;
    }

    .toc,
    .settings {
      width: 100vw;
    }

    .jump-back {
      bottom: 104px;
      padding: 9px 14px;
      font-size: 0.78rem;
    }

    .progress {
      padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
    }

    .empty-card h1 {
      font-size: 1.15rem;
    }
  }
</style>
