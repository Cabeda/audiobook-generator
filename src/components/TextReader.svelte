<script lang="ts">
  import { onDestroy, untrack, onMount } from 'svelte'
  import type { Chapter } from '../lib/types/book'
  import { getTTSWorker } from '../lib/ttsWorkerManager'

  let {
    chapter,
    voice,
    quantization,
    device = 'auto',
    selectedModel = 'kokoro',
    onClose,
  } = $props<{
    chapter: Chapter
    voice: string
    quantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper'
    onClose: () => void
  }>()

  interface TextSegment {
    index: number
    text: string
  }

  // State
  let segments = $state<TextSegment[]>([])
  let audioSegments = $state(new Map<number, string>()) // segment index -> blob URL
  let bufferedSegments = $state<boolean[]>([]) // Reactive array for UI state
  let currentSegmentIndex = $state(-1)
  let isPlaying = $state(false)
  let isGenerating = $state(false)
  let audio: HTMLAudioElement | null = null
  let bufferTarget = 5 // Number of segments to buffer ahead
  let bufferStatus = $state({ ready: 0, total: 0 })
  const SPEED_KEY = 'text_reader_speed'

  // Initialize from localStorage if available
  let initialSpeed = 1.0
  try {
    const saved = localStorage.getItem(SPEED_KEY)
    if (saved) initialSpeed = parseFloat(saved)
  } catch (e) {
    // ignore
  }

  let playbackSpeed = $state(initialSpeed)
  let pendingGenerations = new Map<number, Promise<void>>()

  // Split text into segments (sentences)
  function splitIntoSegments(text: string): TextSegment[] {
    // Split by sentence-ending punctuation followed by space or newline
    // Keep the punctuation with the sentence
    const sentences = text.split(/(?<=[.!?])\s+/)
    return sentences
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text, index) => ({ index, text }))
  }

  // Initialize segments
  $effect(() => {
    if (chapter) {
      const newSegments = splitIntoSegments(chapter.content)
      segments = newSegments
      bufferedSegments = new Array(newSegments.length).fill(false)
      untrack(() => cleanup())
    }
  })

  // Update playback speed when changed
  $effect(() => {
    if (audio) {
      audio.playbackRate = playbackSpeed
    }
    try {
      localStorage.setItem(SPEED_KEY, playbackSpeed.toString())
    } catch (e) {
      // ignore
    }
  })

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 1000

  // Generate audio for a specific segment
  async function generateSegment(index: number): Promise<void> {
    if (audioSegments.has(index)) return // Already generated

    // Return existing promise if already generating
    if (pendingGenerations.has(index)) {
      return pendingGenerations.get(index)
    }

    const segment = segments[index]
    if (!segment) {
      console.error(
        `generateSegment: Segment ${index} not found in segments array (length ${segments.length})`
      )
      return
    }

    const promise = (async () => {
      let lastError: unknown

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const worker = getTTSWorker()
          const blob = await worker.generateVoice({
            text: segment.text,
            modelType: selectedModel,
            voice: voice,
            dtype: selectedModel === 'kokoro' ? quantization : undefined,
            device: device,
          })

          const url = URL.createObjectURL(blob)
          audioSegments.set(index, url)
          bufferedSegments[index] = true // Trigger fine-grained reactivity
          return // Success
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          if (errorMsg.includes('Cancelled')) {
            throw err // Don't retry if cancelled
          }

          console.warn(
            `Failed to generate segment ${index} (attempt ${attempt}/${MAX_RETRIES}):`,
            err
          )
          lastError = err

          if (attempt < MAX_RETRIES) {
            // Wait before retrying with exponential backoff
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
          }
        }
      }

      console.error(`Failed to generate segment ${index} after ${MAX_RETRIES} attempts`)
      throw lastError
    })()

    pendingGenerations.set(index, promise)

    try {
      await promise
    } finally {
      pendingGenerations.delete(index)
    }
  }

  // Generate multiple segments (for buffering)
  async function bufferSegments(startIndex: number, count: number): Promise<void> {
    isGenerating = true

    try {
      const promises: Promise<void>[] = []
      for (let i = 0; i < count; i++) {
        const index = startIndex + i
        if (index >= segments.length) break
        if (audioSegments.has(index)) continue // Skip already generated

        // Generate in parallel (pipeline requests to worker)
        promises.push(generateSegment(index))
      }

      if (promises.length > 0) {
        await Promise.all(promises)
      }
    } finally {
      isGenerating = false
      updateBufferStatus()
    }
  }

  // Update buffer status for display
  function updateBufferStatus() {
    if (currentSegmentIndex < 0) {
      bufferStatus = { ready: 0, total: 0 }
      return
    }

    const remaining = segments.length - currentSegmentIndex
    const targetCount = Math.min(bufferTarget, remaining)
    let readyCount = 0

    for (let i = 0; i < targetCount; i++) {
      if (bufferedSegments[currentSegmentIndex + i]) {
        readyCount++
      }
    }

    // Only update if changed to avoid unnecessary re-renders
    const newStatus = { ready: readyCount, total: targetCount }
    if (bufferStatus.ready !== newStatus.ready || bufferStatus.total !== newStatus.total) {
      bufferStatus = newStatus
    }
  }

  // Play segment at specific index
  async function playFromSegment(index: number) {
    if (index < 0 || index >= segments.length) return

    // Stop current playback
    if (audio) {
      audio.pause()
      audio = null
    }

    // Cancel any pending generation to prioritize this jump
    const worker = getTTSWorker()
    worker.cancelAll()
    pendingGenerations.clear()

    currentSegmentIndex = index
    isPlaying = true

    // Ensure current segment is generated
    if (!audioSegments.has(index)) {
      try {
        await generateSegment(index)
      } catch (err) {
        console.error('Failed to generate segment:', err)
        // Only stop if we are still trying to play this segment
        if (currentSegmentIndex === index) {
          isPlaying = false
        }
        return
      }
    }

    // Check if user switched segment while generating
    if (currentSegmentIndex !== index) return

    // Start buffering ahead
    bufferSegments(index + 1, bufferTarget).catch(console.error)

    // Play current segment
    playCurrentSegment()

    // Scroll to current segment
    scrollToSegment(index)
  }

  async function playCurrentSegment() {
    const index = currentSegmentIndex
    let url = audioSegments.get(index)

    // If audio is missing (buffer underrun), generate it now
    if (!url) {
      console.log(`Buffer underrun for segment ${index}, generating...`)
      isGenerating = true
      try {
        await generateSegment(index)

        // Check if user switched segment or stopped while generating
        if (currentSegmentIndex !== index || !isPlaying) {
          isGenerating = false
          return
        }

        url = audioSegments.get(index)
        if (!url) throw new Error('Generation finished but no URL found')
      } catch (err) {
        console.error('Failed to recover segment:', err)
        // Only stop if we are still on the same segment
        if (currentSegmentIndex === index) {
          isPlaying = false
        }
        isGenerating = false
        return
      } finally {
        isGenerating = false
      }
    }

    audio = new Audio(url)
    audio.playbackRate = playbackSpeed

    audio.onended = () => {
      // Move to next segment
      const nextIndex = currentSegmentIndex + 1
      if (nextIndex < segments.length && isPlaying) {
        currentSegmentIndex = nextIndex

        // Check buffer and replenish if needed
        const buffered = countBufferedSegments()
        if (buffered < 3) {
          // Buffer running low, generate more
          bufferSegments(currentSegmentIndex + 1, bufferTarget).catch(console.error)
        }

        // Clean up old segments (keep only last 5 behind current position)
        cleanupOldSegments()

        playCurrentSegment()
        scrollToSegment(currentSegmentIndex)
      } else {
        // Finished or stopped
        isPlaying = false
        audio = null
      }
    }

    audio.onerror = (err) => {
      console.error('Audio playback error:', err)
      // Try to recover from playback error by regenerating
      if (currentSegmentIndex === index) {
        console.log('Attempting to recover from playback error...')
        audioSegments.delete(index)
        playCurrentSegment()
      }
    }

    audio.play().catch((err) => {
      console.error('Failed to play audio:', err)
      if (currentSegmentIndex === index) {
        isPlaying = false
        audio = null
      }
    })

    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => updateBufferStatus())
  }

  function countBufferedSegments(): number {
    let count = 0
    for (let i = 1; i <= bufferTarget; i++) {
      if (audioSegments.has(currentSegmentIndex + i)) {
        count++
      } else {
        break
      }
    }
    return count
  }

  function cleanupOldSegments() {
    const keepBehind = 5
    const threshold = currentSegmentIndex - keepBehind

    for (const [index, url] of audioSegments.entries()) {
      if (index < threshold) {
        URL.revokeObjectURL(url)
        audioSegments.delete(index)
        bufferedSegments[index] = false
      }
    }
    // No need to trigger reactivity - segments are already rendered
  }

  function scrollToSegment(index: number) {
    requestAnimationFrame(() => {
      const element = document.getElementById(`segment-${index}`)
      const container = document.querySelector('.text-content')

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
    if (isPlaying) {
      pause()
    } else {
      if (audio && audio.paused && !audio.ended) {
        // Resume existing audio
        isPlaying = true
        audio.play().catch(console.error)
      } else if (currentSegmentIndex >= 0) {
        // Restart current segment (or start if not created)
        isPlaying = true
        playCurrentSegment()
      } else {
        // Start from beginning
        playFromSegment(0)
      }
    }
  }

  function pause() {
    isPlaying = false
    if (audio) {
      audio.pause()
    }
  }

  function stop() {
    isPlaying = false
    currentSegmentIndex = -1
    if (audio) {
      audio.pause()
      audio = null
    }
    updateBufferStatus()
  }

  function cleanup() {
    // Revoke all blob URLs
    for (const url of audioSegments.values()) {
      URL.revokeObjectURL(url)
    }
    audioSegments.clear()

    if (audio) {
      audio.pause()
      audio = null
    }

    isPlaying = false
    currentSegmentIndex = -1
    updateBufferStatus()
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
    cleanup()
  })
</script>

<div class="reader-overlay" role="dialog" aria-modal="true" aria-labelledby="chapter-title">
  <div class="reader-container" data-theme={currentTheme}>
    <!-- Header -->
    <div class="reader-header">
      <h2 id="chapter-title">{chapter.title}</h2>
      <button class="close-button" onclick={onClose} aria-label="Close reader">✕</button>
    </div>

    <!-- Controls -->
    <div class="controls" role="toolbar" aria-label="Playback controls">
      <button
        onclick={togglePlayPause}
        disabled={isGenerating && currentSegmentIndex < 0}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '⏸️ Pause' : '▶️ Play'}
      </button>
      <button onclick={stop} disabled={currentSegmentIndex < 0} aria-label="Stop playback"
        >⏹️ Stop</button
      >

      <div class="control-group">
        <label for="speed">Speed:</label>
        <select id="speed" bind:value={playbackSpeed} aria-label="Playback speed">
          <option value={0.5}>0.5x</option>
          <option value={0.75}>0.75x</option>
          <option value={1.0}>1.0x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2.0}>2.0x</option>
        </select>
      </div>

      <div class="control-group">
        <label for="theme">Theme:</label>
        <select
          id="theme"
          value={currentTheme}
          onchange={(e) => changeTheme(e.currentTarget.value as Theme)}
          aria-label="Color theme"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="sepia">Sepia</option>
        </select>
      </div>

      <div class="status" aria-live="polite">
        {#if isGenerating}
          <span class="generating">⏳ Generating...</span>
        {:else if isPlaying}
          <span class="playing">
            Segment {currentSegmentIndex + 1} of {segments.length}
          </span>
        {/if}
      </div>

      {#if bufferStatus.total > 0}
        <div class="buffer-status" class:low={bufferStatus.ready < 3} aria-live="off">
          Buffer: {bufferStatus.ready}/{bufferStatus.total}
          {bufferStatus.ready === bufferStatus.total ? '✓' : '⚠️'}
        </div>
      {/if}
    </div>

    <!-- Text content -->
    <div class="text-content" role="feed" aria-label="Chapter content">
      {#each segments as segment (segment.index)}
        <span
          id="segment-{segment.index}"
          class="segment"
          class:reading={currentSegmentIndex === segment.index}
          class:buffered={bufferedSegments[segment.index]}
          class:clickable={true}
          onclick={() => playFromSegment(segment.index)}
          role="button"
          tabindex="0"
          aria-current={currentSegmentIndex === segment.index ? 'true' : undefined}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              playFromSegment(segment.index)
            }
          }}
        >
          {segment.text}
        </span>
      {/each}
    </div>
  </div>
</div>

<style>
  /* Theme Variables */
  .reader-container {
    --bg-color: #ffffff;
    --text-color: #333333;
    --header-bg: #ffffff;
    --control-bg: #f8f8f8;
    --border-color: #e0e0e0;
    --button-bg: #ffffff;
    --button-border: #dddddd;
    --button-hover: #f0f0f0;
    --button-text: #333333;
    --highlight-bg: #fff9c4;
    --highlight-border: #fbc02d;
    --highlight-text: #000000;
    --buffered-text: #666666;
    --scrollbar-track: #f1f1f1;
    --scrollbar-thumb: #888888;
    --scrollbar-thumb-hover: #555555;
    --overlay-bg: rgba(0, 0, 0, 0.5);
  }

  .reader-container[data-theme='dark'] {
    --bg-color: #1a1a1a;
    --text-color: #e0e0e0;
    --header-bg: #1a1a1a;
    --control-bg: #222222;
    --border-color: #333333;
    --button-bg: #333333;
    --button-border: #444444;
    --button-hover: #444444;
    --button-text: #e0e0e0;
    --highlight-bg: rgba(255, 255, 255, 0.15);
    --highlight-border: rgba(255, 255, 255, 0.1);
    --highlight-text: #ffffff;
    --buffered-text: #ffffff;
    --scrollbar-track: #1a1a1a;
    --scrollbar-thumb: #444444;
    --scrollbar-thumb-hover: #555555;
    --overlay-bg: rgba(0, 0, 0, 0.85);
  }

  .reader-container[data-theme='sepia'] {
    --bg-color: #f4ecd8;
    --text-color: #5b4636;
    --header-bg: #f4ecd8;
    --control-bg: #e9e0c9;
    --border-color: #d7cbb1;
    --button-bg: #f4ecd8;
    --button-border: #d7cbb1;
    --button-hover: #e9e0c9;
    --button-text: #5b4636;
    --highlight-bg: #e6dcb8;
    --highlight-border: #d7cbb1;
    --highlight-text: #2c1e16;
    --buffered-text: #8b6b52;
    --scrollbar-track: #e9e0c9;
    --scrollbar-thumb: #d7cbb1;
    --scrollbar-thumb-hover: #bfae8f;
    --overlay-bg: rgba(60, 50, 40, 0.7);
  }

  .reader-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--overlay-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
    backdrop-filter: blur(4px);
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
    background: var(--bg-color);
    color: var(--text-color);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    max-width: 800px;
    width: 90%;
    height: 90vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s ease-out;
    border: 1px solid var(--border-color);
    transition:
      background-color 0.3s,
      color 0.3s;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .reader-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 32px;
    border-bottom: 1px solid var(--border-color);
    background: var(--header-bg);
    border-radius: 12px 12px 0 0;
    transition:
      background-color 0.3s,
      border-color 0.3s;
  }

  .reader-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-color);
    flex: 1;
    letter-spacing: -0.01em;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-color);
    opacity: 0.6;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: var(--button-hover);
    opacity: 1;
  }

  .controls {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 16px 32px;
    border-bottom: 1px solid var(--border-color);
    background: var(--control-bg);
    flex-wrap: wrap;
    transition:
      background-color 0.3s,
      border-color 0.3s;
  }

  .controls button {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .controls button:hover:not(:disabled) {
    background: var(--button-hover);
  }

  .controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-color);
    opacity: 0.8;
  }

  .control-group select {
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid var(--button-border);
    background: var(--button-bg);
    color: var(--button-text);
    font-size: 13px;
    cursor: pointer;
  }

  .control-group select:focus {
    outline: none;
    border-color: var(--text-color);
  }

  .status {
    margin-left: auto;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-color);
    opacity: 0.7;
  }

  .status .playing {
    color: #4caf50;
  }

  .status .generating {
    color: #ff9800;
  }

  .buffer-status {
    padding: 4px 8px;
    background: #1e3a20;
    color: #81c784;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #2e7d32;
  }

  .buffer-status.low {
    background: #3e2723;
    color: #ffcc80;
    border-color: #e65100;
  }

  .text-content {
    flex: 1;
    overflow-y: auto;
    padding: 40px 60px;
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

  .segment {
    margin: 0;
    padding: 2px 4px;
    border-radius: 4px;
    transition:
      background-color 0.2s,
      color 0.2s;
    cursor: default;
    display: inline; /* Make text flow continuously */
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  /* Add spacing between segments to let them breathe, but keep flow */
  .segment::after {
    content: ' ';
  }

  .segment.clickable {
    cursor: pointer;
  }

  .segment.clickable:hover {
    background: var(--highlight-bg);
    opacity: 0.7;
  }

  .segment.reading {
    background: var(--highlight-bg);
    color: var(--highlight-text);
    box-shadow: 0 0 0 2px var(--highlight-border);
  }

  /* Subtle indicator for buffered segments */
  .segment.buffered:not(.reading) {
    color: var(--buffered-text);
  }

  /* Scrollbar styling */
  .text-content::-webkit-scrollbar {
    width: 10px;
  }

  .text-content::-webkit-scrollbar-track {
    background: var(--scrollbar-track);
    border-left: 1px solid var(--border-color);
  }

  .text-content::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 5px;
    border: 2px solid var(--scrollbar-track);
  }

  .text-content::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  @media (max-width: 640px) {
    .text-content {
      padding: 24px;
      font-size: 16px;
    }

    .reader-header {
      padding: 16px;
    }

    .controls {
      padding: 12px 16px;
      gap: 12px;
    }
  }
</style>
