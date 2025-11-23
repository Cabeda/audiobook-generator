<script lang="ts">
  import { onDestroy, untrack, onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import type { Chapter } from '../lib/types/book'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { audioPlayerStore } from '../stores/audioPlayerStore'

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
    selectedModel?: 'kokoro' | 'piper'
    onBack: () => void
    onChapterChange?: (chapter: Chapter) => void
  }>()

  interface TextSegment {
    index: number
    text: string
  }

  // Local state for rendering
  let segments = $state<TextSegment[]>([])
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

  // Initialize
  $effect(() => {
    if (chapter) {
      segments = splitIntoSegments(chapter.content)

      // Check if we need to initialize the service
      const store = $audioPlayerStore
      const needsInit =
        store.chapterId !== chapter.id ||
        store.bookId !== bookId ||
        store.voice !== voice ||
        store.selectedModel !== selectedModel ||
        store.quantization !== quantization

      if (needsInit) {
        audioService.initialize(bookId, bookTitle, chapter, {
          voice,
          quantization,
          device,
          selectedModel,
          playbackSpeed: initialSpeed,
        })
        // Auto-play when opening a new chapter (async without blocking effect)
        audioService.play().catch((err) => {
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

  // Scroll to current segment
  $effect(() => {
    const index = audioService.currentSegmentIndex
    if (index >= 0) {
      scrollToSegment(index)
    }
  })

  function scrollToSegment(index: number) {
    requestAnimationFrame(() => {
      const element = document.getElementById(`segment-${index}`)
      const container = document.querySelector('.reader-container') // Updated selector

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
  })

  function changeTheme(theme: Theme) {
    currentTheme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (e) {
      // ignore
    }
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
      <button class="back-button" onclick={handleClose} aria-label="Back to book"> ← Back </button>
      <h2 id="chapter-title">{chapter.title}</h2>
      <div class="header-spacer"></div>
    </div>

    <!-- Text Content -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="text-content" role="main" onclick={() => (showSettings = false)}>
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
    </div>

    <!-- Bottom Bar -->
    <div class="bottom-bar">
      <div class="bar-content">
        <div class="playback-controls">
          <button
            class="control-btn"
            onclick={() => audioService.skipPrevious()}
            aria-label="Previous"
          >
            ⏮️
          </button>
          <button
            class="control-btn play-pause"
            onclick={togglePlayPause}
            aria-label={audioService.isPlaying ? 'Pause' : 'Play'}
          >
            {audioService.isPlaying ? '⏸️' : '▶️'}
          </button>
          <button class="control-btn" onclick={() => audioService.skipNext()} aria-label="Next">
            ⏭️
          </button>
        </div>

        <div class="settings-toggle">
          <button
            class="control-btn"
            onclick={() => (showSettings = !showSettings)}
            aria-label="Settings"
            aria-expanded={showSettings}
          >
            ⚙️
          </button>
        </div>
      </div>
    </div>

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

        <div class="setting-item info">
          <div class="info-row">
            <span class="label">Model:</span>
            <span class="value">{selectedModel}</span>
          </div>
          <div class="info-row">
            <span class="label">Voice:</span>
            <span class="value">{voice}</span>
          </div>
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

  /* Bottom Bar */
  .bottom-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--header-bg);
    border-top: 1px solid var(--border-color);
    padding: 16px 24px;
    z-index: 100;
    backdrop-filter: blur(10px);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
  }

  .bar-content {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .playback-controls {
    display: flex;
    align-items: center;
    gap: 24px;
    flex: 1;
    justify-content: center;
  }

  .control-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 24px;
    padding: 8px;
    border-radius: 50%;
    transition:
      transform 0.1s,
      background-color 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
  }

  .control-btn:hover {
    background: var(--surface-color);
    transform: scale(1.1);
  }

  .control-btn.play-pause {
    background: var(--text-color);
    color: var(--bg-color);
    font-size: 20px;
  }

  .control-btn.play-pause:hover {
    transform: scale(1.05);
    filter: brightness(1.2);
  }

  /* Settings Menu */
  .settings-menu {
    position: fixed;
    bottom: 90px;
    right: 24px;
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

    .bottom-bar {
      padding: 12px 16px;
    }

    .settings-menu {
      right: 16px;
      left: 16px;
      width: auto;
      bottom: 80px;
    }
  }
</style>
