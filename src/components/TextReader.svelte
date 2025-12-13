<script lang="ts">
  import { onDestroy, untrack, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { get } from 'svelte/store'
  import type { Chapter } from '../lib/types/book'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import { selectedVoice as voiceStore, selectedModel as modelStore } from '../stores/ttsStore'
  import AudioPlayerBar from './AudioPlayerBar.svelte'

  let {
    chapter,
    bookId,
    bookTitle,
    voice,
    quantization,
    device = 'auto',
    selectedModel = 'kokoro',
    onBack,
    onChapterChange,
  } = $props<{
    chapter: Chapter
    bookId: number | null
    bookTitle: string
    voice: string
    quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper' | 'web_speech'
    onBack: () => void
    onChapterChange?: (chapter: Chapter) => void
  }>()

  const SPEED_KEY = 'text_reader_speed'

  // Initialize from localStorage if available
  let initialSpeed = 1.0
  try {
    const saved = localStorage.getItem(SPEED_KEY)
    if (saved) initialSpeed = parseFloat(saved)
  } catch (e) {
    // ignore
  }

  // Settings menu state
  let showSettings = $state(false)
  let webSpeechVoices = $state<SpeechSynthesisVoice[]>([])

  // Track the current model and voice from the store to detect changes
  // Will be initialized after first initialization to avoid false change detection
  let currentModelFromStore = $state<'kokoro' | 'piper' | 'web_speech' | null>(null)
  let currentVoiceFromStore = $state<string | null>(null)
  let textContentEl: HTMLDivElement | null = null

  // State for initialization
  let loadError = $state(false)
  let isLoading = $state(true)

  // Initialize by loading pre-generated data from DB
  $effect(() => {
    if (chapter && bookId) {
      const cId = chapter.id
      const bId = bookId

      // Check if already loaded for this chapter
      const needsLoad = untrack(() => {
        const store = get(audioPlayerStore)
        return !(store.bookId === bId && store.chapterId === cId)
      })

      if (needsLoad) {
        isLoading = true
        loadError = false

        // Load chapter from DB using pure playback method
        audioService
          .loadChapter(bId, bookTitle, chapter)
          .then((success) => {
            isLoading = false
            if (success) {
              const store = get(audioPlayerStore)
              const startSeg = store.chapterId === chapter.id ? store.segmentIndex : 0

              audioService
                .playFromSegment(startSeg)
                .then(() => audioService.play())
                .catch((err) => {
                  console.error('Auto-play failed:', err)
                })
            } else {
              loadError = true
              console.warn('Chapter audio not available - generate audio first')
            }
          })
          .catch((err) => {
            isLoading = false
            loadError = true
            console.error('Failed to load chapter:', err)
          })
      } else {
        isLoading = false
        const store = get(audioPlayerStore)
        const startSeg = store.chapterId === chapter.id ? store.segmentIndex : 0
        audioService
          .playFromSegment(startSeg)
          .then(() => audioService.play())
          .catch((err) => {
            console.error('Auto-play failed:', err)
          })
      }
    }
  })

  // Update playback speed when changed
  function updateSpeed(speed: number) {
    audioService.setSpeed(speed)
    try {
      localStorage.setItem(SPEED_KEY, speed.toString())
    } catch (e) {
      // ignore
    }
  }

  function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let offset = 0
    let startNode: Node | null = null
    let startOffset = 0
    let endNode: Node | null = null
    let endOffset = 0

    let current = walker.nextNode()
    while (current) {
      const len = current.textContent?.length ?? 0
      if (!startNode && start >= offset && start <= offset + len) {
        startNode = current
        startOffset = start - offset
      }
      if (!endNode && end <= offset + len) {
        endNode = current
        endOffset = end - offset
        break
      }
      offset += len
      current = walker.nextNode()
    }

    if (!startNode || !endNode) return null
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  function injectSegmentsIntoContent() {
    if (!textContentEl) return
    const root = textContentEl

    // If segments are already present (e.g., pre-wrapped content), keep them
    const existing = root.querySelectorAll('span[id^="seg-"]')
    if (existing.length) {
      existing.forEach((el) => el.classList.add('segment'))
      return
    }

    const segments = audioService.segments
    if (!segments?.length) return

    const fullText = root.textContent || ''

    const normalizeWithMap = (text: string) => {
      const normalizedChars: string[] = []
      const normToOriginal: number[] = []
      let lastWasSpace = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue
          normalizedChars.push(' ')
          normToOriginal.push(i)
          lastWasSpace = true
        } else {
          normalizedChars.push(ch)
          normToOriginal.push(i)
          lastWasSpace = false
        }
      }
      return { normalized: normalizedChars.join(''), normToOriginal }
    }

    const normalizedFull = normalizeWithMap(fullText)
    let searchNormIndex = 0

    for (const segment of segments) {
      const normalizedSegment = normalizeWithMap(segment.text)
      if (!normalizedSegment.normalized) continue

      const startNorm = normalizedFull.normalized.indexOf(
        normalizedSegment.normalized,
        searchNormIndex
      )
      if (startNorm === -1) continue
      const endNorm = startNorm + normalizedSegment.normalized.length

      const start = normalizedFull.normToOriginal[startNorm]
      const endOriginalIdx = normalizedFull.normToOriginal[endNorm - 1]
      const end = endOriginalIdx !== undefined ? endOriginalIdx + 1 : start + segment.text.length

      const range = rangeFromTextOffsets(root, start, end)
      if (!range || range.collapsed) continue

      const span = document.createElement('span')
      span.className = 'segment'
      span.id = `seg-${segment.index}`

      try {
        const contents = range.extractContents()
        span.appendChild(contents)
        range.insertNode(span)
      } catch (err) {
        console.warn('Failed to wrap segment for highlighting', err)
      }

      searchNormIndex = endNorm
    }
  }

  // Scroll to current segment
  $effect(() => {
    const index = audioService.currentSegmentIndex
    if (index >= 0) {
      updateActiveSegment(index)
      scrollToSegment(index)
    }
  })

  // Inject segment wrappers so the active sentence can be highlighted
  $effect(() => {
    const ready = !isLoading && !loadError
    const segmentCount = audioService.segments.length
    const chapterId = chapter?.id
    if (!ready || !segmentCount || !chapterId) return

    injectSegmentsIntoContent()

    if (audioService.currentSegmentIndex >= 0) {
      updateActiveSegment(audioService.currentSegmentIndex)
      scrollToSegment(audioService.currentSegmentIndex)
    }
  })

  // Ensure initial highlight if already playing
  $effect(() => {
    if (audioService.isPlaying && audioService.currentSegmentIndex >= 0) {
      updateActiveSegment(audioService.currentSegmentIndex)
    }
  })

  function updateActiveSegment(index: number) {
    // Remove active class from all segments
    const active = document.querySelectorAll('.segment.active')
    active.forEach((el) => el.classList.remove('active'))

    // Add to current
    const el = document.getElementById(`seg-${index}`)
    if (el) {
      el.classList.add('active')
    }
  }

  function scrollToSegment(index: number) {
    requestAnimationFrame(() => {
      const element = document.getElementById(`seg-${index}`)
      const container = document.querySelector('.reader-container')

      if (element && container) {
        const elementRect = element.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()

        // Check if element is within the comfortable reading zone (middle 60% of view)
        const topThreshold = containerRect.top + containerRect.height * 0.2
        const bottomThreshold = containerRect.bottom - containerRect.height * 0.2

        const isAbove = elementRect.top < topThreshold
        const isBelow = elementRect.bottom > bottomThreshold

        if (isAbove || isBelow) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    })
  }

  function handleContentClick(event: MouseEvent) {
    showSettings = false
    const target = event.target as HTMLElement
    // Check if clicked element is a segment or inside one
    const segmentEl = target.closest('.segment')
    if (segmentEl && segmentEl.id.startsWith('seg-')) {
      const index = parseInt(segmentEl.id.replace('seg-', ''), 10)
      if (!isNaN(index)) {
        audioService.playFromSegment(index)
      }
    }
  }

  function handleClose() {
    // Don't stop the audio; keep playback running and minimize the persistent player
    audioPlayerStore.minimize()
    onBack()
  }

  // Theme support
  type Theme = 'light' | 'dark' | 'sepia'
  const THEME_KEY = 'text_reader_theme'
  let currentTheme = $state<Theme>('dark')
  const themeOrder: Theme[] = ['light', 'dark', 'sepia']
  const themeIcons: Record<Theme, string> = {
    light: '☀️',
    dark: '🌙',
    sepia: '📖',
  }
  const themeLabels: Record<Theme, string> = {
    light: 'Light',
    dark: 'Dark',
    sepia: 'Sepia',
  }

  onMount(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY)
      if (savedTheme && ['light', 'dark', 'sepia'].includes(savedTheme)) {
        currentTheme = savedTheme as Theme
      }
    } catch (e) {
      // ignore
    }

    // Load Web Speech voices
    const loadVoices = () => {
      webSpeechVoices = window.speechSynthesis.getVoices()
    }
    loadVoices()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }
  })

  function changeTheme(theme: Theme) {
    currentTheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (e) {
      // ignore
    }
  }

  function cycleTheme() {
    const currentIndex = themeOrder.indexOf(currentTheme)
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length]
    changeTheme(nextTheme)
  }

  onDestroy(() => {
    // We don't stop audio on destroy anymore!
    // But we might want to unsubscribe if we had manual subscriptions
  })
</script>

<div class="reader-page" data-theme={currentTheme}>
  <div class="reader-container">
    <!-- Header -->
    <div class="reader-header">
      <div class="header-row top">
        <button class="back-button" onclick={handleClose} aria-label="Back to book">
          ← Back
        </button>
        <div class="header-title">
          <div class="eyebrow">{bookTitle}</div>
          <div class="main-title" aria-label="Chapter title">{chapter.title}</div>
        </div>
        <div class="header-actions">
          <button
            class="theme-toggle"
            onclick={cycleTheme}
            aria-label={`Switch theme (current ${themeLabels[currentTheme]})`}
          >
            <span class="theme-icon">{themeIcons[currentTheme]}</span>
            <span class="theme-label">{themeLabels[currentTheme]}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Text Content -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="text-content" role="main" onclick={handleContentClick} bind:this={textContentEl}>
      {#if isLoading}
        <div class="loading-indicator">
          <div class="spinner"></div>
          <p>Loading chapter audio...</p>
        </div>
      {:else if loadError}
        <div class="error-message">
          <p>⚠️ Audio not available</p>
          <p>Generate audio for this chapter first.</p>
          <button class="back-link" onclick={handleClose}>← Back to book</button>
        </div>
      {:else}
        <!-- We render the full HTML content with segments. Active segment highlighting is managed by the updateActiveSegment function. -->
        {@html chapter.content}
      {/if}
    </div>

    <!-- Bottom Bar -->
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
          <button class="close-settings" onclick={() => (showSettings = false)}>✕</button>
        </div>

        <div class="setting-item">
          <label for="speed-select">Speed</label>
          <div class="speed-selector">
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 0.75}
              onclick={() => updateSpeed(0.75)}>0.75x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.0}
              onclick={() => updateSpeed(1.0)}>1.0x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.25}
              onclick={() => updateSpeed(1.25)}>1.25x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 1.5}
              onclick={() => updateSpeed(1.5)}>1.5x</button
            >
            <button
              class="speed-btn"
              class:active={audioService.playbackSpeed === 2.0}
              onclick={() => updateSpeed(2.0)}>2.0x</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label for="theme-select">Theme</label>
          <div class="theme-selector">
            <button
              class="theme-btn"
              class:active={currentTheme === 'light'}
              onclick={() => changeTheme('light')}>☀️ Light</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'dark'}
              onclick={() => changeTheme('dark')}>🌙 Dark</button
            >
            <button
              class="theme-btn"
              class:active={currentTheme === 'sepia'}
              onclick={() => changeTheme('sepia')}>📖 Sepia</button
            >
          </div>
        </div>

        <div class="setting-item">
          <label for="model-select">Model</label>
          <select
            id="model-select"
            value={selectedModel}
            onchange={(e) => {
              // @ts-ignore
              modelStore.set(e.currentTarget.value)
            }}
            class="model-select"
          >
            <option value="kokoro">Kokoro</option>
            <option value="piper">Piper</option>
            <option value="web_speech">Web Speech</option>
          </select>
        </div>

        <div class="setting-item info">
          {#if selectedModel === 'web_speech'}
            <label for="voice-select">Voice</label>
            <select
              id="voice-select"
              value={voice}
              onchange={(e) => {
                // @ts-ignore
                voiceStore.set(e.currentTarget.value)
              }}
              class="voice-select"
            >
              {#each webSpeechVoices as v}
                <option value={v.name}>{v.name} ({v.lang})</option>
              {/each}
            </select>
          {:else}
            <div class="info-row">
              <span class="label">Voice:</span>
              <span class="value">{voice}</span>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(:root) {
    --bg-color: #ffffff;
    --text-color: #000000;
    --secondary-text: #475569;
    --active-bg: #ffe0b2;
    --active-text: #000;
    --header-bg: #ffffff;
    --border-color: #e0e0e0;
    --surface-color: #f5f5f5;
    --unprocessed-text: #000000;
    --hover-bg: rgba(255, 183, 77, 0.15);
  }

  [data-theme='light'] {
    --bg-color: #ffffff;
    --text-color: #000000;
    --secondary-text: #475569;
    --active-bg: #ffe0b2;
    --active-text: #000;
    --header-bg: #ffffff;
    --border-color: #e0e0e0;
    --surface-color: #f5f5f5;
    --unprocessed-text: #000000;
    --hover-bg: rgba(255, 183, 77, 0.15);
  }

  [data-theme='dark'] {
    --bg-color: #1a1a1a;
    --text-color: #f1f5f9;
    --secondary-text: #cbd5e1;
    --active-bg: #3d3d3d;
    --active-text: #fff;
    --bg-color: #1a1a1a;
    --header-bg: #1a1a1a;
    --border-color: #333;
    --surface-color: #2a2a2a;
    --unprocessed-text: #ffffff;
    --hover-bg: rgba(255, 255, 255, 0.08);
  }

  [data-theme='sepia'] {
    --bg-color: #f4ecd8;
    --text-color: #5b4636;
    --secondary-text: #7b604b;
    --active-bg: #e6dcb8;
    --active-text: #000;
    --header-bg: #f4ecd8;
    --border-color: #dccfb4;
    --surface-color: #eaddc5;
    --highlight-bg: #ffecb3;
    --highlight-text: #000;
    --highlight-border: #ffca28;
    --buffered-text: #8d6e63;
    --unprocessed-text: #8b7355;
    --hover-bg: rgba(139, 115, 85, 0.1);
  }

  .reader-page {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-color);
    color: var(--text-color);
    z-index: 999;
    animation: fadeIn 0.2s ease-out;
    transition:
      background-color 0.3s,
      color 0.3s;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .reader-container {
    width: 100%;
    height: 100%;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
  }

  .reader-header {
    display: flex;
    flex-direction: column;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color);
    background: var(--header-bg);
    color: var(--text-color);
    position: sticky;
    top: 0;
    z-index: 10;
    isolation: isolate;
    mix-blend-mode: normal;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    transition:
      background-color 0.3s,
      border-color 0.3s;
    gap: 16px;
  }

  .back-button {
    background: none;
    border: 1px solid var(--border-color);
    color: var(--text-color);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.95rem;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .back-button:hover {
    background: var(--surface-color);
    border-color: var(--text-color);
  }

  .reader-page[data-theme='dark'] .back-button {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--border-color);
    color: var(--text-color);
  }

  .reader-page[data-theme='dark'] .back-button:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--text-color);
  }

  .header-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .header-row.top {
    width: 100%;
  }

  .header-title {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .header-title .eyebrow {
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--secondary-text, var(--text-color));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-title .main-title {
    font-size: 19px;
    font-weight: 700;
    color: var(--text-color);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 140px;
    justify-self: flex-end;
  }

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--surface-color);
    color: var(--text-color);
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
    min-width: 110px;
  }

  .theme-toggle:hover {
    border-color: var(--text-color);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.18);
  }

  .reader-page[data-theme='dark'] .theme-toggle {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(148, 163, 184, 0.35);
  }

  .reader-page[data-theme='dark'] .theme-toggle:hover {
    border-color: var(--text-color);
    background: rgba(255, 255, 255, 0.1);
  }

  .theme-icon {
    font-size: 1rem;
  }

  .theme-label {
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .text-content {
    flex: 1;
    overflow-y: auto;
    padding: 40px 60px 100px 60px; /* Added bottom padding for bar */
    line-height: 1.8;
    font-family:
      'Inter',
      system-ui,
      -apple-system,
      sans-serif;
    font-size: 18px;
    color: var(--text-color);
    transition: color 0.3s;
  }

  /* Style for injected segments */
  :global(.segment) {
    cursor: pointer;
    border-radius: 2px;
    transition:
      background-color 0.2s,
      color 0.2s;
  }

  :global(.segment:hover) {
    background-color: var(--hover-bg);
  }

  :global(.segment.active) {
    background-color: var(--active-bg);
    color: var(--active-text);
    box-shadow: 0 0 0 2px var(--highlight-border, #ffb74d);
  }

  /* Settings Menu */
  .settings-menu {
    position: fixed;
    bottom: 90px;
    right: max(24px, calc((100vw - 900px) / 2 + 24px));
    background: var(--header-bg);
    border: 1px solid var(--border-color);
    border-radius: 12px;
    padding: 16px;
    width: 300px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
    z-index: 101;
  }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-color);
  }

  .settings-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .close-settings {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-color);
    font-size: 18px;
    padding: 4px;
  }

  .setting-item {
    margin-bottom: 16px;
  }

  .setting-item label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }

  .speed-selector {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .speed-btn {
    flex: 1;
    padding: 6px 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .speed-btn:hover {
    background: var(--surface-color);
  }

  .model-select,
  .voice-select {
    width: 100%;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    font-size: 14px;
  }

  /* Subtle indicator for buffered segments */
  .theme-selector {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    flex: 1;
    padding: 6px 4px;
    border: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .theme-btn:hover {
    background: var(--surface-color);
  }

  .theme-btn.active {
    background: var(--text-color);
    color: var(--bg-color);
    border-color: var(--text-color);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    margin-bottom: 4px;
    color: var(--text-color);
    opacity: 0.8;
  }

  .info-row .value {
    font-weight: 500;
  }

  @media (max-width: 640px) {
    .text-content {
      padding: 24px 24px 100px 24px;
      font-size: 16px;
    }

    .settings-menu {
      right: 16px;
      left: 16px;
      width: auto;
      bottom: 80px;
    }
  }
</style>
