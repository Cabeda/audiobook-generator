<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
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
      for (let i = 0; i < count; i++) {
        const index = startIndex + i
        if (index >= segments.length) break
        if (audioSegments.has(index)) continue // Skip already generated

        // Generate sequentially to avoid flooding the main thread
        await generateSegment(index)

        // Yield to let UI update and prevent staggering
        await new Promise((resolve) => setTimeout(resolve, 50))

        // If we stopped playing or closed, stop buffering
        if (!isPlaying && currentSegmentIndex === -1) break
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

  onDestroy(() => {
    cleanup()
  })
</script>

<div class="reader-overlay" role="dialog" aria-modal="true" aria-labelledby="chapter-title">
  <div class="reader-container">
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

      <div class="speed-control">
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
        <p
          id="segment-{segment.index}"
          class="segment"
          class:reading={currentSegmentIndex === segment.index}
          class:buffered={bufferedSegments[segment.index]}
          class:clickable={true}
          onclick={() => playFromSegment(segment.index)}
          role="button"
          tabindex="0"
          aria-current={currentSegmentIndex === segment.index ? 'true' : undefined}
          onkeypress={(e) => {
            if (e.key === 'Enter') playFromSegment(segment.index)
          }}
        >
          {segment.text}
        </p>
      {/each}
    </div>
  </div>
</div>

<style>
  .reader-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease-out;
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
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 800px;
    width: 90%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s ease-out;
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
    padding: 20px 24px;
    border-bottom: 1px solid #e0e0e0;
  }

  .reader-header h2 {
    margin: 0;
    font-size: 22px;
    color: #333;
    flex: 1;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 28px;
    color: #666;
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
    background: #f0f0f0;
    color: #333;
  }

  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid #e0e0e0;
    background: #f8f8f8;
    flex-wrap: wrap;
  }

  .controls button {
    padding: 10px 20px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: white;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .controls button:hover:not(:disabled) {
    background: #f0f0f0;
    border-color: #ccc;
  }

  .controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .speed-control {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: #333;
  }

  .speed-control select {
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #ddd;
    background: white;
    font-size: 14px;
  }

  .status {
    margin-left: auto;
    font-size: 14px;
    font-weight: 500;
    color: #666;
  }

  .status .playing {
    color: #4caf50;
  }

  .status .generating {
    color: #ff9800;
  }

  .buffer-status {
    padding: 6px 12px;
    background: #e8f5e9;
    color: #2e7d32;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
  }

  .buffer-status.low {
    background: #fff3e0;
    color: #e65100;
  }

  .text-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    line-height: 1.8;
  }

  .segment {
    margin: 0 0 16px 0;
    padding: 12px;
    padding-left: 8px; /* Fixed padding to match reading state */
    border-left: 4px solid transparent; /* Pre-allocate border space */
    border-radius: 6px;
    transition:
      background-color 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;
    cursor: default;
  }

  .segment.clickable {
    cursor: pointer;
  }

  .segment.clickable:hover {
    background: #f5f5f5;
  }

  .segment.buffered {
    border-left-color: #e0e0e0;
  }

  .segment.reading {
    background: #fff9c4;
    border-left-color: #fbc02d;
    box-shadow: 0 2px 8px rgba(251, 192, 45, 0.2);
  }

  /* Scrollbar styling */
  .text-content::-webkit-scrollbar {
    width: 8px;
  }

  .text-content::-webkit-scrollbar-track {
    background: #f1f1f1;
  }

  .text-content::-webkit-scrollbar-thumb {
    background: #888;
    border-radius: 4px;
  }

  .text-content::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
</style>
