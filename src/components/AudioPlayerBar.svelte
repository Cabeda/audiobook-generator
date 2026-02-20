<script lang="ts">
  import { audioPlayerStore, currentPlaybackInfo } from '../stores/audioPlayerStore'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { onMount } from 'svelte'
  import type { Chapter } from '../lib/types/book'

  let {
    mode = 'persistent',
    onMaximize,
    onClose,
    onSettings,
    showSettings = false,
    chapter = undefined,
    bookTitle = undefined,
    bookId = undefined,
    voice = undefined,
    quantization = undefined,
    device = 'auto',
    selectedModel = 'kokoro',
  } = $props<{
    mode?: 'persistent' | 'reader'
    onMaximize?: () => void
    onClose?: () => void
    onSettings?: () => void
    showSettings?: boolean
    chapter?: Chapter
    bookTitle?: string
    bookId?: number | null
    voice?: string
    quantization?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    device?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper'
  }>()

  let playerState = $derived($audioPlayerStore)
  let playbackInfo = $derived($currentPlaybackInfo)

  // Format time as MM:SS
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Handlers
  async function handlePlayPause(e: MouseEvent) {
    e.stopPropagation()

    // If we're in reader mode and have chapter info but no segments, trigger generation
    if (mode === 'reader' && chapter && audioService.segments.length === 0) {
      try {
        const { generationService } = await import('../lib/services/generationService')
        await generationService.generateChapters([chapter])
      } catch (err) {
        console.error('Failed to generate chapter:', err)
      }
    } else {
      audioService.togglePlayPause()
    }
  }

  function handleSkipForward(e: MouseEvent) {
    e.stopPropagation()
    audioService.skipNext()
  }

  function handleSkipBackward(e: MouseEvent) {
    e.stopPropagation()
    audioService.skipPrevious()
  }

  function handleSkip10Back(e: MouseEvent) {
    e.stopPropagation()
    audioService.skip(-10)
  }

  function handleSkip10Forward(e: MouseEvent) {
    e.stopPropagation()
    audioService.skip(10)
  }

  function handleBarClick(e: MouseEvent) {
    if (mode !== 'persistent') return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    onMaximize?.()
  }

  function handleBarKeyDown(e: KeyboardEvent) {
    if (mode !== 'persistent') return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onMaximize?.()
    }
  }

  // Helper used to detect focus on interactive elements
  function isInteractiveElement(el: Element | null) {
    if (!el) return false
    const tag = el.tagName
    if (!tag) return false
    const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']
    if (interactiveTags.includes(tag)) return true
    const role = el.getAttribute && el.getAttribute('role')
    if (role === 'button' || role === 'textbox' || role === 'link') return true
    // contenteditable or within settings menu should be treated as interactive
    if ((el as HTMLElement).isContentEditable) return true
    if (el.closest && el.closest('.settings-menu')) return true
    return false
  }

  onMount(() => {
    // Add global keydown handler: when no element is focused/selected, Space toggles play/pause
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      // Only care about Space key
      if (e.code !== 'Space' && e.key !== ' ') return

      // If a text selection exists, don't toggle playback
      try {
        const sel = window.getSelection && window.getSelection()
        if (sel && sel.toString && sel.toString().length > 0) return
      } catch (_) {
        // ignore any selection errors
      }

      const active = document.activeElement
      // If an interactive element is focused, let it handle the event
      if (isInteractiveElement(active as Element)) return

      // Prevent default (e.g. page scrolling) and toggle play/pause
      e.preventDefault()
      audioService.togglePlayPause()
    }

    document.addEventListener('keydown', handleGlobalKeydown)
    return () => {
      document.removeEventListener('keydown', handleGlobalKeydown)
    }
  })
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="audio-player-bar"
  class:persistent={mode === 'persistent'}
  class:reader={mode === 'reader'}
  role={mode === 'persistent' ? 'button' : undefined}
  tabindex={mode === 'persistent' ? 0 : -1}
  aria-label={mode === 'persistent' ? 'Expand player' : undefined}
  onclick={handleBarClick}
  onkeydown={handleBarKeyDown}
>
  <div class="player-content">
    <!-- Book/Chapter Info (Persistent Mode Only) -->
    {#if mode === 'persistent'}
      <div class="info">
        <div class="book-title">{playbackInfo.bookTitle || 'Audiobook'}</div>
        <div class="chapter-title">{playbackInfo.chapterTitle || 'Chapter'}</div>
      </div>
    {/if}

    <!-- Controls -->
    <div class="controls">
      <button
        class="control-btn skip-10"
        onclick={handleSkip10Back}
        aria-label="Skip back 10 seconds"
        title="Skip back 10 seconds"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-8.38" />
        </svg>
        <span class="skip-label">10</span>
      </button>

      <button
        class="control-btn"
        onclick={handleSkipBackward}
        aria-label="Previous segment"
        title="Previous segment"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>

      <button
        class="control-btn play-pause"
        onclick={handlePlayPause}
        aria-label={playbackInfo.isPlaying ? 'Pause' : 'Play'}
      >
        {#if playerState.isBuffering && playbackInfo.isPlaying}
          <span class="spinner" aria-hidden="true"></span>
        {:else if playbackInfo.isPlaying}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        {:else}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        {/if}
      </button>

      <button
        class="control-btn"
        onclick={handleSkipForward}
        aria-label="Next segment"
        title="Next segment"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M13 19l7-7-7-7M5 19l7-7-7-7" />
        </svg>
      </button>

      <button
        class="control-btn skip-10"
        onclick={handleSkip10Forward}
        aria-label="Skip forward 10 seconds"
        title="Skip forward 10 seconds"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
        </svg>
        <span class="skip-label">10</span>
      </button>
    </div>

    <!-- Progress Section -->
    <div class="progress-section" aria-hidden={false}>
      <div class="time">{formatTime(playerState.currentTime)}</div>
      <div
        class="progress-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(playbackInfo.progress * 100)}
      >
        <div
          class="progress-fill"
          style="width: {Math.max(0, Math.min(100, playbackInfo.progress * 100))}%"
        ></div>
      </div>
    </div>

    <!-- Extra Actions -->
    <div class="actions">
      {#if mode === 'reader'}
        <button
          class="control-btn settings-btn"
          class:active={showSettings}
          onclick={(e) => {
            e.stopPropagation()
            onSettings?.()
          }}
          aria-label="Settings"
          aria-expanded={showSettings}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"
            />
          </svg>
        </button>
      {/if}

      {#if mode === 'persistent'}
        <button
          class="control-btn close-btn"
          onclick={(e) => {
            e.stopPropagation()
            onClose?.()
          }}
          aria-label="Close player"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .audio-player-bar {
    background: var(--surface-color);
    border-top: 1px solid var(--border-color);
    box-shadow: 0 -2px 12px var(--shadow-color);
    transition: background-color 0.2s;
  }

  .audio-player-bar.persistent {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    cursor: pointer;
    animation: slideUp 0.3s ease-out;
  }

  .audio-player-bar.reader {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
  }

  .audio-player-bar:hover {
    background: var(--bg-color);
  }

  @keyframes slideUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .player-content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 20px;
  }

  /* Persistent mode grid layout */
  .persistent .player-content {
    display: grid;
    grid-template-columns: 1fr auto 2fr auto;
  }

  /* Reader mode flex layout */
  .reader .player-content {
    justify-content: space-between;
  }

  .info {
    min-width: 0;
  }

  .book-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapter-title {
    font-size: 12px;
    color: var(--secondary-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  /* Center controls in reader mode */
  .reader .controls {
    flex: 1;
    justify-content: center;
  }

  .control-btn {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color 0.2s,
      transform 0.2s;
    position: relative;
  }

  .control-btn.skip-10 {
    position: relative;
  }

  .control-btn.skip-10 .skip-label {
    position: absolute;
    font-size: 10px;
    font-weight: bold;
    pointer-events: none;
  }

  .control-btn:hover {
    background: var(--feature-bg);
    transform: scale(1.1);
  }

  .control-btn.play-pause {
    background: var(--primary-color);
    color: var(--bg-color);
    width: 40px;
    height: 40px;
  }

  .control-btn.play-pause:hover {
    background: var(--primary-hover);
    transform: scale(1.05);
  }

  .control-btn.settings-btn.active {
    background: var(--selected-bg);
  }

  .spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .progress-section {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .reader .progress-section {
    max-width: 400px;
  }

  .time {
    font-size: 12px;
    color: var(--secondary-text);
    font-variant-numeric: tabular-nums;
    min-width: 40px;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
    min-width: 100px;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .close-btn:hover {
    background: var(--error-bg);
    color: var(--error-color);
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .persistent .player-content {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      gap: 12px;
      padding: 12px 16px;
    }

    .persistent .info {
      grid-column: 1;
      grid-row: 1;
    }

    .persistent .controls {
      grid-column: 1;
      grid-row: 2;
      justify-content: center;
    }

    .persistent .progress-section {
      grid-column: 1;
      grid-row: 3;
    }

    .persistent .actions {
      position: absolute;
      top: 12px;
      right: 12px;
    }

    /* Reader mode mobile */
    .reader .player-content {
      padding: 6px 12px 8px;
      gap: 4px;
      flex-wrap: wrap;
    }

    .reader .controls {
      gap: 2px;
      order: 1;
      flex: 1 1 100%;
      justify-content: center;
    }

    .reader .progress-section {
      order: 2;
      flex: 1 1 100%;
      max-width: 100%;
      padding: 0 4px;
    }

    .reader .actions {
      order: 0;
      position: absolute;
      top: 8px;
      right: 12px;
    }

    .reader .control-btn {
      padding: 6px;
    }

    .reader .control-btn.play-pause {
      width: 36px;
      height: 36px;
    }

    .time {
      font-size: 11px;
      min-width: 35px;
    }
  }
</style>
