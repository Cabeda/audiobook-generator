<script lang="ts">
  import { onDestroy, untrack, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { Chapter } from '../lib/types/book'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'
  import { selectedVoice as voiceStore, selectedModel as modelStore } from '../stores/ttsStore'
  import AudioPlayerBar from './AudioPlayerBar.svelte'
  import DOMPurify from 'dompurify'
  import { processHtmlAndGetSegments } from '../lib/htmlSegmenter'

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

  interface TextSegment {
    index: number
    text: string
  }

  // Local state for rendering
  let segments = $state<TextSegment[]>([])
  let hasHtmlContent = $state(false)
  let sanitizedHtml = $state('')
  let readerContainer: HTMLElement
  let autoScroll = $state(true)
  const SPEED_KEY = 'text_reader_speed'

  // Initialize from localStorage if available
  let initialSpeed = 1.0
  try {
    const saved = localStorage.getItem(SPEED_KEY)
    if (saved) initialSpeed = parseFloat(saved)
  } catch (e) {
    // ignore
  }

  // Split text into segments (sentences)
  function splitIntoSegments(text: string): TextSegment[] {
    const sentences = text.split(/(?<=[.!?])\s+/)
    return sentences
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text, index) => ({ index, text }))
  }

  // Initialize
  // Settings menu state
  let showSettings = $state(false)
  let webSpeechVoices = $state<SpeechSynthesisVoice[]>([])

  // Initialize
  $effect(() => {
    if (chapter) {
      // Use untrack to prevent reactive loop when reading store
      const needsInit = untrack(() => {
        const store = $audioPlayerStore
        // If the player is already set up for this chapter, don't re-initialize
        // We check bookId and chapter.id (assuming chapter has id, or we use index if id missing)
        // The previous code used chapter.id. Let's assume chapter has id.
        // If not, we might need another way. But let's stick to the pattern.
        // If chapter doesn't have id, we might rely on title or index.
        // Let's check the type definition of Chapter.
        return store.bookId !== bookId || store.chapterId !== chapter.id
      })

      if (needsInit) {
        // Check if we have HTML content
        if (chapter.htmlContent) {
          hasHtmlContent = true
          // Process HTML to inject segment markers and extract segments
          const result = processHtmlAndGetSegments(chapter.htmlContent)
          sanitizedHtml = result.html

          // Create TextSegment objects from the extracted strings
          segments = result.segments.map((text: string, index: number) => ({ index, text }))

          // Reconstruct content string for audio service to ensure alignment
          const alignedContent = segments.map((s) => s.text).join(' ')

          // Initialize audio service with aligned content
          audioService.initialize(
            bookId,
            bookTitle,
            { ...chapter, content: alignedContent }, // Override content
            {
              voice,
              quantization,
              device,
              selectedModel,
              playbackSpeed: initialSpeed,
            }
          )
        } else {
          hasHtmlContent = false
          sanitizedHtml = ''
          segments = splitIntoSegments(chapter.content)

          audioService.initialize(bookId, bookTitle, chapter, {
            voice,
            quantization,
            device,
            selectedModel,
            playbackSpeed: initialSpeed,
          })
        }

        // Auto-play when opening a new chapter (async without blocking effect)
        audioService.play().catch((err) => {
          console.error('Auto-play failed:', err)
        })
      } else {
        // If we don't need init, we still need to populate local state (segments, html)
        // because we might be returning to the view.
        // But we shouldn't call audioService.initialize.

        if (chapter.htmlContent) {
          hasHtmlContent = true
          const result = processHtmlAndGetSegments(chapter.htmlContent)
          sanitizedHtml = result.html
          segments = result.segments.map((text: string, index: number) => ({ index, text }))
        } else {
          hasHtmlContent = false
          sanitizedHtml = ''
          segments = splitIntoSegments(chapter.content)
        }
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

  // Scroll to current segment and highlight
  $effect(() => {
    const index = audioService.currentSegmentIndex

    // Handle scrolling
    if (index >= 0 && autoScroll) {
      scrollToSegment(index)
    }

    // Handle highlighting for HTML content
    // For plain text, svelte handles it via class:active in the loop
    if (hasHtmlContent && readerContainer) {
      // Remove active class from previously active segment
      const prevActive = readerContainer.querySelector('.html-content .segment.active')
      if (prevActive) {
        prevActive.classList.remove('active')
      }

      // Add active class to current segment
      // Note: A segment might span multiple spans if we split nodes.
      // We should highlight ALL spans with this segment index.
      // We also include the ID selector as a fallback for the first span of the segment
      const currentSegments = readerContainer.querySelectorAll(
        `[data-segment-index="${index}"], #segment-${index}`
      )
      currentSegments.forEach((el) => el.classList.add('active'))
    }
  })

  function scrollToSegment(index: number) {
    requestAnimationFrame(() => {
      const element =
        document.getElementById(`segment-${index}`) ||
        readerContainer?.querySelector(`[data-segment-index="${index}"]`)
      const container = readerContainer

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

  function togglePlayPause() {
    audioService.togglePlayPause()
  }

  function pause() {
    audioService.pause()
  }

  function stop() {
    audioService.stop()
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault()
      audioService.togglePlayPause()
    } else if (e.code === 'ArrowRight') {
      audioService.skipNext()
    } else if (e.code === 'ArrowLeft') {
      audioService.skipPrevious()
    }
  }

  function handleHtmlClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    // Find the closest segment element
    const segment = target.closest('.segment') as HTMLElement

    if (segment && segment.dataset.segmentIndex) {
      e.stopPropagation()
      const index = parseInt(segment.dataset.segmentIndex, 10)
      if (!isNaN(index)) {
        audioService.playFromSegment(index)
      }
    }
  }

  onDestroy(() => {
    // We don't stop audio on destroy anymore!
    // But we might want to unsubscribe if we had manual subscriptions
  })
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="reader-page" data-theme={currentTheme}>
  <div class="reader-container" bind:this={readerContainer}>
    <!-- Header -->
    <div class="reader-header">
      <button class="back-button" onclick={handleClose} aria-label="Back to book"> ← Back </button>
      <h2 id="chapter-title">{chapter.title}</h2>
      <div class="header-spacer"></div>
      <button
        class="icon-button"
        class:active={autoScroll}
        onclick={() => (autoScroll = !autoScroll)}
        title="Toggle Auto-scroll"
        aria-label="Toggle Auto-scroll"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </button>
    </div>

    <!-- Text Content -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="text-content" role="main" onclick={() => (showSettings = false)}>
      {#if hasHtmlContent}
        <!-- HTML Content with sanitization -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="html-content" onclick={handleHtmlClick} role="article">
          {@html sanitizedHtml}
        </div>
      {:else}
        <!-- Plain text with segment highlighting -->
        {#each segments as segment (segment.index)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span
            id="segment-{segment.index}"
            class="segment"
            class:active={audioService.currentSegmentIndex === segment.index}
            class:unprocessed={segment.index > audioService.currentSegmentIndex}
            onclick={(e) => {
              e.stopPropagation()
              audioService.playFromSegment(segment.index)
            }}
            role="button"
            tabindex="0"
            aria-current={audioService.currentSegmentIndex === segment.index ? 'true' : undefined}
          >
            {segment.text}{' '}
          </span>
        {/each}
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
    --text-color: #e0e0e0;
    --active-bg: #3d3d3d;
    --active-text: #fff;
    --header-bg: #1a1a1a;
    --border-color: #333;
    --surface-color: #2a2a2a;
    --unprocessed-text: #ffffff;
    --hover-bg: rgba(255, 255, 255, 0.08);
  }

  [data-theme='sepia'] {
    --bg-color: #f4ecd8;
    --text-color: #5b4636;
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
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color);
    background: var(--header-bg);
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

  .reader-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-color);
    flex: 1;
    letter-spacing: -0.01em;
    text-align: center;
  }

  .header-spacer {
    width: 80px; /* Same width as back button to center title */
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

  /* HTML Content Styling */
  .html-content :global(p) {
    margin: 1em 0;
    line-height: 1.8;
  }

  .html-content :global(img) {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 1.5em auto;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .html-content :global(h1),
  .html-content :global(h2),
  .html-content :global(h3),
  .html-content :global(h4),
  .html-content :global(h5),
  .html-content :global(h6) {
    margin: 1.5em 0 0.75em;
    font-weight: 600;
    color: var(--text-color);
  }

  .html-content :global(ul),
  .html-content :global(ol) {
    margin: 1em 0;
    padding-left: 2em;
  }

  .html-content :global(li) {
    margin: 0.5em 0;
  }

  .html-content :global(blockquote) {
    margin: 1.5em 0;
    padding: 1em 1.5em;
    border-left: 4px solid var(--border-color);
    background: var(--surface-color);
    font-style: italic;
  }

  .html-content :global(code) {
    background: var(--surface-color);
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }

  .html-content :global(pre) {
    background: var(--surface-color);
    padding: 1em;
    border-radius: 6px;
    overflow-x: auto;
    margin: 1em 0;
  }

  .html-content :global(a) {
    color: #4a90e2;
    text-decoration: underline;
  }

  .html-content :global(a:hover) {
    color: #357abd;
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

  .segment {
    cursor: pointer;
    transition:
      color 0.6s cubic-bezier(0.4, 0, 0.2, 1),
      background-color 0.3s ease,
      transform 0.2s ease,
      box-shadow 0.3s ease;
    border-radius: 4px;
    padding: 2px 4px;
    margin: -2px -4px;
  }

  .segment:hover {
    background: var(--hover-bg);
    transform: translateY(-1px);
  }

  .segment.unprocessed {
    color: var(--unprocessed-text);
    font-weight: 500;
  }

  .segment.active {
    background: var(--highlight-bg, #ffe0b2);
    color: var(--highlight-text, #000);
    box-shadow: 0 0 0 2px var(--highlight-border, #ffb74d);
    border-radius: 4px;
    animation: highlightPulse 0.4s ease-out;
  }

  @keyframes highlightPulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.02);
    }
    100% {
      transform: scale(1);
    }
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
    background: var(--active-bg);
    color: var(--active-text);
    border-color: var(--border-color);
  }

  .icon-button {
    background: none;
    border: none;
    color: var(--text-color);
    cursor: pointer;
    padding: 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  }

  .icon-button:hover {
    background-color: var(--surface-color);
  }

  .icon-button.active {
    background-color: var(--active-bg);
    color: var(--active-text);
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    background: var(--surface-color);
    border-radius: 6px;
  }

  .info-row .label {
    font-weight: 500;
    font-size: 14px;
  }

  .info-row .value {
    font-family: monospace;
    font-size: 14px;
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
