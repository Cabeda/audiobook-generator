<script lang="ts">
  import { audioPlayerStore, currentPlaybackInfo } from '../stores/audioPlayerStore'
  import { audioService } from '../lib/audioPlaybackService.svelte'
  import { appTheme } from '../stores/themeStore'

  // Props
  let { onMaximize } = $props<{
    onMaximize: () => void
  }>()

  // Subscribe to store
  let playerState = $derived($audioPlayerStore)
  let playbackInfo = $derived($currentPlaybackInfo)

  // Format time as MM:SS
  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Handlers
  function handlePlayPause() {
    audioService.togglePlayPause()
  }

  function handleSkipForward() {
    audioService.skipNext()
  }

  function handleSkipBackward() {
    audioService.skipPrevious()
  }

  function handleClose() {
    // Stop playback and clear the player state so the persistent player hides
    audioService.stop()
    audioPlayerStore.stop()
  }

  function handleBarClick(e: MouseEvent) {
    // Don't maximize if clicking on buttons
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    onMaximize()
  }
</script>

<div class="persistent-player" class:dark={$appTheme === 'dark'} onclick={handleBarClick}>
  <div class="player-content">
    <!-- Book/Chapter Info -->
    <div class="info">
      <div class="book-title">{playbackInfo.bookTitle || 'Audiobook'}</div>
      <div class="chapter-title">{playbackInfo.chapterTitle || 'Chapter'}</div>
    </div>

    <!-- Controls -->
    <div class="controls">
      <button
        class="control-btn"
        onclick={handleSkipBackward}
        aria-label="Skip backward 10 seconds"
        title="Skip backward 10s"
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
        aria-label="Skip forward 10 seconds"
        title="Skip forward 10s"
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
    </div>

    <!-- Progress Bar -->
    <div class="progress-section">
      <div class="time">{formatTime(playerState.currentTime)}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {playbackInfo.progress * 100}%"></div>
      </div>
      <div class="time">{formatTime(playerState.chapterDuration || playerState.duration)}</div>
    </div>

    <!-- Close Button -->
    <button class="close-btn" onclick={handleClose} aria-label="Close player">
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
  </div>
</div>

<style>
  .persistent-player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    animation: slideUp 0.3s ease-out;
    transition: background 0.2s;
  }

  .persistent-player:hover {
    background: rgba(255, 255, 255, 1);
  }

  .persistent-player.dark {
    background: rgba(30, 30, 30, 0.95);
    border-top-color: rgba(255, 255, 255, 0.1);
  }

  .persistent-player.dark:hover {
    background: rgba(40, 40, 40, 1);
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
    display: grid;
    grid-template-columns: 1fr auto 2fr auto;
    gap: 20px;
    align-items: center;
  }

  .info {
    min-width: 0;
  }

  .book-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chapter-title {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .control-btn {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .control-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    transform: scale(1.1);
  }

  .dark .control-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .control-btn.play-pause {
    background: var(--primary-color);
    color: white;
    width: 40px;
    height: 40px;
  }

  .control-btn.play-pause:hover {
    background: var(--primary-hover);
    transform: scale(1.05);
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

  .dark .spinner {
    border: 2px solid rgba(255, 255, 255, 0.15);
    border-top-color: white;
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
  }

  .time {
    font-size: 12px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 40px;
  }

  .progress-bar {
    flex: 1;
    height: 4px;
    background: rgba(0, 0, 0, 0.1);
    border-radius: 2px;
    overflow: hidden;
    min-width: 100px;
  }

  .dark .progress-bar {
    background: rgba(255, 255, 255, 0.2);
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 8px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(255, 0, 0, 0.1);
    color: #ff0000;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .player-content {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto;
      gap: 12px;
      padding: 12px 16px;
    }

    .info {
      grid-column: 1;
      grid-row: 1;
    }

    .controls {
      grid-column: 1;
      grid-row: 2;
      justify-content: center;
    }

    .progress-section {
      grid-column: 1;
      grid-row: 3;
    }

    .close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
    }
  }
</style>
