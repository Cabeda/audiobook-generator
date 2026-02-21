<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { get } from 'svelte/store'
  import type { Chapter } from '../lib/types/book'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import { selectedVoice as voiceStore, selectedModel as modelStore } from '../stores/ttsStore'
  import { segmentProgress, getGeneratedSegment } from '../stores/segmentProgressStore'
  import { segmentHtmlContent, generationService } from '../lib/services/generationService'
  import type { AudioSegment } from '../lib/types/audio'
  import AudioPlayerBar from './AudioPlayerBar.svelte'
  import logger from '../lib/utils/logger'
  import { saveProgress, loadProgress } from '../lib/progressStore'
  import { loadChapterSegmentProgress } from '../stores/segmentProgressStore'
  import { resolveChapterLanguageWithDetection } from '../lib/utils/languageResolver'
  import { getLanguageLabel } from '../lib/utils/languageResolver'

  let {
    chapters,
    bookId,
    bookTitle,
    book,
    voice,
    quantization,
    device = 'auto',
    selectedModel = 'kokoro',
    initialChapterId,
    onBack,
  } = $props<{
    chapters: Chapter[]
    bookId: number | null
    bookTitle: string
    book: import('../lib/types/book').Book
    voice: string
    quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper' | 'web_speech'
    initialChapterId?: string
    onBack: () => void
  }>()

  // Theme
  type Theme = 'light' | 'dark' | 'sepia'
  const THEME_KEY = 'text_reader_theme'
  let currentTheme = $state<Theme>('dark')
  const themeOrder: Theme[] = ['light', 'dark', 'sepia']

  // Font size
  const FONT_SIZE_KEY = 'text_reader_font_size'
  let fontSize = $state(18)

  // Settings
  let showSettings = $state(false)
  let autoScrollEnabled = $state(true)

  // Current chapter tracking — untrack to avoid state_referenced_locally warning
  // (we intentionally only capture the initial value)
  let activeChapterId = $state<string>(untrack(() => initialChapterId || chapters[0]?.id || ''))
  let activeChapterIndex = $derived(chapters.findIndex((c: Chapter) => c.id === activeChapterId))

  // Loaded chapters — tracks which chapters have been segmented
  let loadedChapters = $state(new Set<string>())
  let chapterHtml = $state(new Map<string, string>())

  // Container ref
  let scrollContainer: HTMLDivElement | null = null
  let chapterRefs = new Map<string, HTMLElement>()

  // Initialize from localStorage
  onMount(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY)
      if (savedTheme && ['light', 'dark', 'sepia'].includes(savedTheme)) {
        currentTheme = savedTheme as Theme
      }
      const savedFs = localStorage.getItem(FONT_SIZE_KEY)
      if (savedFs) fontSize = parseInt(savedFs, 10)
    } catch {
      // ignore
    }

    // Load segments for visible chapters
    loadVisibleChapters()

    // Set up IntersectionObserver for chapter tracking
    setupChapterObserver()

    // Scroll to initial chapter if specified
    if (initialChapterId) {
      requestAnimationFrame(() => {
        const el = chapterRefs.get(initialChapterId!)
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' })
      })
    }

    // Load saved progress
    if (bookId) {
      const progress = loadProgress(String(bookId))
      if (progress) {
        activeChapterId = progress.chapterId
      }
    }
  })

  let observer: IntersectionObserver | null = null

  function setupChapterObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        // Find the most visible chapter
        let maxRatio = 0
        let mostVisible = ''
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            mostVisible = entry.target.getAttribute('data-chapter-id') || ''
          }
        }
        if (mostVisible && mostVisible !== activeChapterId) {
          activeChapterId = mostVisible
        }

        // Lazy load chapters that are becoming visible
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const chId = entry.target.getAttribute('data-chapter-id')
            if (chId && !loadedChapters.has(chId)) {
              loadChapter(chId)
            }
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '200px 0px', // Pre-load chapters 200px before they're visible
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    )

    // Observe all chapter sections
    for (const [, el] of chapterRefs) {
      observer.observe(el)
    }
  }

  /** Svelte action: registers a chapter section element for IntersectionObserver tracking */
  function registerRef(node: HTMLElement, chapterId: string) {
    chapterRefs.set(chapterId, node)
    if (observer) observer.observe(node)
    return {
      destroy() {
        chapterRefs.delete(chapterId)
        if (observer) observer.unobserve(node)
      },
    }
  }

  function loadVisibleChapters() {
    // Load the initial chapter and its neighbors
    const startIdx = initialChapterId
      ? chapters.findIndex((c: Chapter) => c.id === initialChapterId)
      : 0
    const start = Math.max(0, startIdx - 1)
    const end = Math.min(chapters.length, startIdx + 3)

    for (let i = start; i < end; i++) {
      loadChapter(chapters[i].id)
    }
  }

  function loadChapter(chapterId: string) {
    if (loadedChapters.has(chapterId)) return
    const chapter = chapters.find((c: Chapter) => c.id === chapterId)
    if (!chapter) return

    // Segment the HTML content
    const { html } = segmentHtmlContent(chapterId, chapter.content)
    chapterHtml.set(chapterId, html)
    chapterHtml = new Map(chapterHtml) // trigger reactivity

    loadedChapters.add(chapterId)
    loadedChapters = new Set(loadedChapters) // trigger reactivity

    // Load segment progress from DB
    if (bookId) {
      loadChapterSegmentProgress(bookId, chapterId).catch((err) => {
        logger.warn('Failed to load segment progress:', err)
      })
    }
  }

  function getChapterPreferences(chapter: Chapter) {
    const lang = resolveChapterLanguageWithDetection(chapter, book)
    const langLabel = getLanguageLabel(lang)
    const model = chapter.model || selectedModel
    const chVoice = chapter.voice || voice
    return { lang, langLabel, model, voice: chVoice }
  }

  // Handle segment clicks
  function handleContentClick(event: MouseEvent) {
    showSettings = false
    const target = event.target as HTMLElement

    // Prevent link navigation
    if (target.closest('a')) {
      event.preventDefault()
    }

    const segmentEl = target.closest('.segment') as HTMLElement | null
    if (!segmentEl) return

    const index = getSegmentIndex(segmentEl)
    if (index === null) return

    // Find which chapter this segment belongs to
    const chapterSection = segmentEl.closest('[data-chapter-id]')
    const chapterId = chapterSection?.getAttribute('data-chapter-id')
    if (!chapterId) return

    const chapter = chapters.find((c: Chapter) => c.id === chapterId)
    if (!chapter) return

    activateSegment(chapterId, chapter, index)
  }

  function handleContentKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (target.classList.contains('segment') && target.id.startsWith('seg-')) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const index = getSegmentIndex(target)
        if (index === null) return

        const chapterSection = target.closest('[data-chapter-id]')
        const chapterId = chapterSection?.getAttribute('data-chapter-id')
        if (!chapterId) return

        const chapter = chapters.find((c: Chapter) => c.id === chapterId)
        if (!chapter) return

        activateSegment(chapterId, chapter, index)
      }
    }
  }

  function getSegmentIndex(element: HTMLElement | null): number | null {
    if (!element || !element.id.startsWith('seg-')) return null
    const index = parseInt(element.id.replace('seg-', ''), 10)
    return isNaN(index) ? null : index
  }

  async function activateSegment(chapterId: string, chapter: Chapter, index: number) {
    // If switching chapters, load the new chapter audio
    const currentStore = get(audioPlayerStore)
    if (currentStore.chapterId !== chapterId && bookId) {
      activeChapterId = chapterId
      const prefs = getChapterPreferences(chapter)

      await audioService.loadChapter(bookId, bookTitle, chapter, {
        voice: prefs.voice,
        quantization,
        device,
        selectedModel: prefs.model as 'kokoro' | 'piper' | 'web_speech',
        playbackSpeed: audioService.playbackSpeed,
      })
    }

    // Check for progressive segment
    const segmentData = getGeneratedSegment(chapterId, index)
    if (segmentData) {
      audioService.injectProgressiveSegment(segmentData)
    }

    audioService.playFromSegment(index)
  }

  // Auto-scroll to active segment during playback
  $effect(() => {
    if (!autoScrollEnabled || !audioService.isPlaying) return
    const currentIndex = audioService.currentSegmentIndex
    if (currentIndex < 0) return

    const segmentEl = document.getElementById(`seg-${currentIndex}`)
    if (!segmentEl) return

    const rect = segmentEl.getBoundingClientRect()
    const isOutsideViewport = rect.top < 100 || rect.bottom > window.innerHeight - 100
    if (isOutsideViewport) {
      segmentEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })

  // Highlight active segment
  $effect(() => {
    const index = audioService.currentSegmentIndex
    if (index >= 0) {
      const active = document.querySelectorAll('.segment.active')
      active.forEach((el) => el.classList.remove('active'))
      const el = document.getElementById(`seg-${index}`)
      if (el) el.classList.add('active')
    }
  })

  // Update segment visual states based on generation progress
  $effect(() => {
    if (!activeChapterId) return
    const progress = $segmentProgress.get(activeChapterId)
    if (!progress) return

    const chapterEl = chapterRefs.get(activeChapterId)
    if (!chapterEl) return

    const segmentEls = chapterEl.querySelectorAll('span[id^="seg-"]')
    segmentEls.forEach((el) => {
      const indexMatch = el.id.match(/seg-(\d+)/)
      if (!indexMatch) return
      const idx = parseInt(indexMatch[1], 10)
      const isGenerated = progress.generatedIndices.has(idx)

      el.classList.remove('segment-pending', 'segment-generated', 'segment-generating')
      if (isGenerated) {
        el.classList.add('segment-generated')
      } else if (progress.isGenerating && idx === progress.processingIndex) {
        el.classList.add('segment-generating')
      } else if (progress.isGenerating) {
        el.classList.add('segment-pending')
      }
    })
  })

  // Save progress on segment change
  $effect(() => {
    if (bookId && audioService.currentSegmentIndex >= 0 && activeChapterId) {
      saveProgress(String(bookId), activeChapterId, audioService.currentSegmentIndex)
    }
  })

  // Theme / font helpers
  function changeTheme(theme: Theme) {
    currentTheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* ignore */
    }
  }

  function changeFontSize(delta: number) {
    fontSize = Math.min(32, Math.max(12, fontSize + delta))
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
    } catch {
      /* ignore */
    }
  }

  function updateSpeed(speed: number) {
    audioService.setSpeed(speed)
    try {
      localStorage.setItem('text_reader_speed', speed.toString())
    } catch {
      /* ignore */
    }
  }

  function handleClose() {
    audioService.stop()
    onBack()
  }

  function scrollToChapter(chapterId: string) {
    const el = chapterRefs.get(chapterId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      activeChapterId = chapterId
    }
  }

  onDestroy(() => {
    observer?.disconnect()
    audioService.stop()
  })
</script>

<div class="reader-page" data-theme={currentTheme}>
  <div class="reader-container">
    <!-- Sticky Header -->
    <div class="reader-header">
      <div class="header-row top">
        <button class="back-button" onclick={handleClose} aria-label="Back to book">
          &#8592; Back
        </button>
        <div class="header-title">
          <div class="eyebrow">{bookTitle}</div>
          <div class="main-title" aria-label="Current chapter">
            {chapters[activeChapterIndex]?.title || ''}
          </div>
        </div>
        <div class="header-actions">
          <span
            class="chapter-progress"
            aria-label="Chapter {activeChapterIndex + 1} of {chapters.length}"
          >
            {activeChapterIndex + 1} / {chapters.length}
          </span>
        </div>
      </div>
    </div>

    <!-- Continuous Scroll Content -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="text-content continuous"
      role="main"
      style="font-size: {fontSize}px"
      onclick={handleContentClick}
      onkeydown={handleContentKeyDown}
      bind:this={scrollContainer}
    >
      {#each chapters as chapter, i (chapter.id)}
        {@const prefs = getChapterPreferences(chapter)}
        {@const html = chapterHtml.get(chapter.id)}
        {@const isActive = chapter.id === activeChapterId}

        <section
          class="chapter-section"
          class:active={isActive}
          data-chapter-id={chapter.id}
          use:registerRef={chapter.id}
        >
          <!-- Chapter Divider -->
          <div class="chapter-divider" id="chapter-{chapter.id}">
            <div class="chapter-divider-line"></div>
            <div class="chapter-divider-content">
              <h2 class="chapter-title">{chapter.title}</h2>
              <div class="chapter-meta">
                <span class="meta-tag">{prefs.langLabel}</span>
                <span class="meta-tag">{prefs.model}</span>
                {#if chapter.voice}
                  <span class="meta-tag">{chapter.voice}</span>
                {/if}
              </div>
            </div>
          </div>

          <!-- Chapter Content -->
          <div class="chapter-content">
            {#if html}
              {@html html}
            {:else}
              <div class="chapter-loading">
                <p class="loading-text">Scroll to load...</p>
              </div>
            {/if}
          </div>
        </section>
      {/each}

      <!-- End of book marker -->
      <div class="end-of-book">
        <p>End of book</p>
      </div>
    </div>

    <!-- Audio Player Bar -->
    <AudioPlayerBar
      mode="reader"
      {showSettings}
      onSettings={() => (showSettings = !showSettings)}
    />

    <!-- Settings Menu -->
    {#if showSettings}
      <div class="settings-menu" transition:fade={{ duration: 100 }}>
        <div class="settings-header">
          <h3>Playback Settings</h3>
          <button class="close-settings" onclick={() => (showSettings = false)}>&#10005;</button>
        </div>

        <div class="setting-item">
          <span class="setting-label">Speed</span>
          <div class="speed-selector">
            {#each [0.75, 1.0, 1.25, 1.5, 2.0] as speed}
              <button
                class="speed-btn"
                class:active={audioService.playbackSpeed === speed}
                onclick={() => updateSpeed(speed)}>{speed}x</button
              >
            {/each}
          </div>
        </div>

        <div class="setting-item">
          <span class="setting-label">Font Size</span>
          <div class="font-size-selector">
            <button
              class="font-size-btn"
              onclick={() => changeFontSize(-2)}
              aria-label="Decrease font size">A&#8722;</button
            >
            <span class="font-size-value">{fontSize}px</span>
            <button
              class="font-size-btn"
              onclick={() => changeFontSize(2)}
              aria-label="Increase font size">A+</button
            >
          </div>
        </div>

        <div class="setting-item">
          <span class="setting-label">Theme</span>
          <div class="theme-selector">
            <button
              class="theme-btn"
              class:active={currentTheme === 'light'}
              onclick={() => changeTheme('light')}>Light</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'dark'}
              onclick={() => changeTheme('dark')}>Dark</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'sepia'}
              onclick={() => changeTheme('sepia')}>Sepia</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label>
            <input type="checkbox" bind:checked={autoScrollEnabled} />
            Auto-scroll during playback
          </label>
        </div>

        <!-- Chapter Jump -->
        <div class="setting-item">
          <span class="setting-label">Jump to Chapter</span>
          <select
            class="chapter-select"
            onchange={(e) => scrollToChapter((e.target as HTMLSelectElement).value)}
          >
            {#each chapters as ch, i}
              <option value={ch.id} selected={ch.id === activeChapterId}>
                {i + 1}. {ch.title}
              </option>
            {/each}
          </select>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .reader-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
    color: var(--text-color);
  }

  .reader-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .reader-header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--header-bg);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border-color);
    padding: 8px 16px;
    flex-shrink: 0;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .back-button {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 8px 0;
    white-space: nowrap;
  }

  .back-button:hover {
    color: var(--text-color);
  }

  .header-title {
    flex: 1;
    min-width: 0;
    text-align: center;
  }

  .eyebrow {
    font-size: 0.7rem;
    color: var(--secondary-text);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .main-title {
    font-size: 0.9rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header-actions {
    flex-shrink: 0;
  }

  .chapter-progress {
    font-size: 0.8rem;
    color: var(--secondary-text);
  }

  /* Continuous scroll content */
  .text-content.continuous {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0 20px 120px;
    scroll-behavior: smooth;
  }

  .chapter-section {
    margin-bottom: 24px;
  }

  .chapter-divider {
    padding: 32px 0 16px;
    position: relative;
  }

  .chapter-divider-line {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--border-color);
  }

  .chapter-divider-content {
    position: relative;
    background: var(--bg-color);
    display: inline-block;
    padding-right: 16px;
  }

  .chapter-title {
    font-size: 1.3rem;
    font-weight: 700;
    margin: 0 0 6px;
    color: var(--text-color);
    line-height: 1.3;
  }

  .chapter-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .meta-tag {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--surface-color);
    color: var(--secondary-text);
    border: 1px solid var(--border-color);
  }

  .chapter-content {
    line-height: 1.8;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .chapter-content :global(p) {
    margin: 0.8em 0;
  }

  .chapter-content :global(h1),
  .chapter-content :global(h2),
  .chapter-content :global(h3) {
    margin: 1.2em 0 0.6em;
    font-weight: 600;
  }

  .chapter-loading {
    padding: 40px 0;
    text-align: center;
  }

  .loading-text {
    color: var(--secondary-text);
    font-style: italic;
    font-size: 0.9rem;
  }

  .end-of-book {
    text-align: center;
    padding: 40px 0;
    color: var(--secondary-text);
    font-style: italic;
    font-size: 0.9rem;
  }

  /* Segment styles */
  .chapter-content :global(.segment) {
    cursor: pointer;
    border-radius: 3px;
    transition: background 0.2s;
    padding: 1px 0;
  }

  .chapter-content :global(.segment:hover) {
    background: var(--hover-bg);
  }

  .chapter-content :global(.segment.active) {
    background: var(--highlight-bg);
    color: var(--highlight-text);
    border-bottom: 2px solid var(--highlight-border);
  }

  .chapter-content :global(.segment-generated) {
    color: var(--buffered-text);
  }

  .chapter-content :global(.segment-pending) {
    color: var(--unprocessed-text);
  }

  .chapter-content :global(.segment-generating) {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }

  /* Settings menu */
  .settings-menu {
    position: absolute;
    bottom: 80px;
    right: 16px;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 16px;
    z-index: 20;
    min-width: 280px;
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .settings-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .close-settings {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 4px;
  }

  .setting-item {
    margin-bottom: 14px;
  }

  .setting-item label,
  .setting-label {
    display: block;
    font-size: 0.8rem;
    color: var(--secondary-text);
    margin-bottom: 6px;
    font-weight: 500;
  }

  .speed-selector,
  .theme-selector {
    display: flex;
    gap: 4px;
  }

  .speed-btn,
  .theme-btn {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-color);
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.8rem;
    transition: all 0.15s;
  }

  .speed-btn.active,
  .theme-btn.active {
    background: var(--active-bg);
    border-color: var(--highlight-border);
    font-weight: 600;
  }

  .font-size-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .font-size-btn {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-color);
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .font-size-value {
    font-size: 0.85rem;
    color: var(--secondary-text);
    min-width: 40px;
    text-align: center;
  }

  .chapter-select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 0.85rem;
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .text-content.continuous {
      padding: 0 14px 120px;
    }

    .chapter-title {
      font-size: 1.1rem;
    }

    .settings-menu {
      left: 8px;
      right: 8px;
      min-width: unset;
    }
  }
</style>
