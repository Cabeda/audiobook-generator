<script lang="ts">
  import type { Chapter } from '../lib/types/book'

  let {
    chapter,
    selected = false,
    audioData = undefined,
    onToggle,
    onRead,
    onDownloadWav,
    onDownloadMp3,
    status,
    error,
    onRetry,
    progress,
  } = $props<{
    chapter: Chapter
    selected?: boolean
    audioData?: { url: string; blob: Blob }
    status?: 'pending' | 'processing' | 'done' | 'error'
    error?: string | null
    onToggle: (id: string) => void
    onRead: (chapter: Chapter) => void
    onDownloadWav: (id: string) => void
    onDownloadMp3: (id: string) => void
    onRetry?: (id: string) => void
    progress?: { current: number; total: number; message?: string }
  }>()

  function copy() {
    navigator.clipboard?.writeText(chapter.content).catch(() => alert('Clipboard not available'))
  }
  let audioElement = $state<HTMLAudioElement | null>(null)

  $effect(() => {
    if (audioElement && audioData?.url) {
      audioElement.load()
    }
  })
</script>

<div class="chapter-card" class:selected role="listitem">
  <div class="card-main">
    <div class="card-content">
      <label class="chapter-header">
        <input
          type="checkbox"
          class="chapter-checkbox"
          checked={selected}
          onchange={() => onToggle(chapter.id)}
          aria-label={`Select chapter: ${chapter.title}`}
        />
        <span class="chapter-title">{chapter.title}</span>
      </label>
      <p class="chapter-preview">
        {chapter.content.slice(0, 180)}{chapter.content.length > 180 ? '…' : ''}
      </p>
    </div>

    <div class="card-actions">
      {#if status === 'processing'}
        <div class="spinner-container">
          <span class="spinner" aria-hidden="true"></span>
        </div>
      {/if}
      <button
        class="action-btn"
        class:disabled={status !== 'done'}
        disabled={status !== 'done'}
        onclick={() => onRead(chapter)}
        title={status === 'done'
          ? `Read chapter: ${chapter.title}`
          : 'Generate audio to read with sync'}
        aria-label={`Read chapter: ${chapter.title}`}
      >
        <span class="icon" aria-hidden="true">📖</span> Read
      </button>

      <button
        class="action-btn icon-only"
        onclick={copy}
        title="Copy text"
        aria-label={`Copy text of chapter: ${chapter.title}`}
      >
        <span aria-hidden="true">📋</span>
      </button>
    </div>
  </div>

  {#if status === 'processing'}
    <div class="progress-details">
      {#if progress?.total}
        <div class="progress-bar-bg">
          <div
            class="progress-fill"
            style="width: {(progress.current / progress.total) * 100}%"
          ></div>
        </div>
        <div class="progress-text">
          <span>Generating chunk {progress.current} of {progress.total}</span>
          {#if progress.message}
            <span class="progress-sub">{progress.message}</span>
          {/if}
        </div>
      {:else}
        <div class="progress-text">
          {progress?.message || 'Preparing generation...'}
        </div>
      {/if}
    </div>
  {/if}

  {#if status === 'error' && error}
    <div class="error-container">
      <details class="error-details">
        <summary class="error-summary">
          <span class="error-icon">❌</span>
          <span class="error-title">Generation Failed</span>
        </summary>
        <div class="error-content">
          <pre class="error-text">{error}</pre>
          <button
            class="copy-error-btn"
            onclick={(e) => {
              e.stopPropagation() // Prevent row selection if needed
              navigator.clipboard.writeText(error).then(() => alert('Error copied to clipboard'))
            }}
          >
            📋 Copy Error
          </button>
        </div>
      </details>
      <button class="retry-btn" onclick={() => onRetry?.(chapter.id)}> 🔄 Retry </button>
    </div>
  {/if}

  {#if audioData}
    <div class="audio-controls">
      <audio
        bind:this={audioElement}
        controls
        src={audioData.url}
        aria-label={`Audio for ${chapter.title}`}
      ></audio>
      <div class="download-actions">
        <button
          class="action-btn small"
          onclick={() => onDownloadWav(chapter.id)}
          aria-label={`Download WAV for ${chapter.title}`}>WAV</button
        >
        <button
          class="action-btn small"
          onclick={() => onDownloadMp3(chapter.id)}
          aria-label={`Download MP3 for ${chapter.title}`}>MP3</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  .chapter-card {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: all 0.2s ease;
  }

  .chapter-card:hover {
    border-color: var(--secondary-text);
    box-shadow: 0 2px 8px var(--shadow-color);
  }

  .chapter-card.selected {
    background: var(--selected-bg);
    border-color: var(--selected-border);
  }

  .card-main {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    width: 100%;
  }

  .card-content {
    flex: 1;
    min-width: 0;
  }

  .chapter-header {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    margin-bottom: 6px;
  }

  .chapter-checkbox {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .chapter-title {
    font-weight: 600;
    font-size: 1.05rem;
    color: var(--text-color);
    line-height: 1.4;
  }

  .chapter-preview {
    margin: 0;
    font-size: 0.9rem;
    color: var(--secondary-text);
    line-height: 1.5;
    padding-left: 30px;
  }

  .card-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--input-border);
    background: var(--surface-color);
    border-radius: 6px;
    font-size: 0.9rem;
    color: var(--secondary-text);
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: var(--bg-color);
    border-color: var(--text-color);
    color: var(--text-color);
  }

  .action-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-color);
    border-color: var(--border-color);
    color: var(--secondary-text);
  }

  .action-btn:disabled:hover {
    background: var(--surface-color);
    border-color: var(--border-color);
    color: var(--secondary-text);
  }

  .action-btn.icon-only {
    padding: 8px;
  }

  .action-btn.small {
    font-size: 0.8rem;
    padding: 4px 8px;
  }

  .audio-controls {
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    animation: slideDown 0.3s ease-out;
  }

  .download-actions {
    display: flex;
    gap: 8px;
  }

  audio {
    flex: 1;
    height: 36px;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Mobile Responsive */
  @media (max-width: 640px) {
    .card-main {
      flex-direction: column;
      gap: 12px;
    }

    .chapter-preview {
      padding-left: 0;
      margin-top: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-actions {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .action-btn {
      justify-content: center;
    }

    .audio-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .download-actions {
      justify-content: flex-end;
    }
  }

  .error-container {
    padding: 12px;
    background-color: rgba(255, 59, 48, 0.1);
    border: 1px solid var(--error-color, #ff3b30);
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .error-message {
    color: var(--error-color, #ff3b30);
    font-size: 0.9rem;
    font-weight: 500;
  }

  .retry-btn {
    background-color: var(--error-color, #ff3b30);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .retry-btn:hover {
    opacity: 0.9;
  }

  .error-container {
    margin-top: 8px;
    padding: 8px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #ef4444;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .error-details {
    width: 100%;
  }

  .error-summary {
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .error-content {
    margin-top: 8px;
    background: #fff;
    padding: 8px;
    border-radius: 4px;
    border: 1px solid #fca5a5;
  }

  .error-text {
    font-family: monospace;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow-y: auto;
    margin: 0 0 8px 0;
    color: #b91c1c;
  }

  .copy-error-btn {
    font-size: 0.8rem;
    padding: 4px 8px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 4px;
    cursor: pointer;
    color: #b91c1c;
  }

  .copy-error-btn:hover {
    background: #fee2e2;
  }
  .spinner-container {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border-color);
    border-top-color: var(--primary-color, #3b82f6);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .progress-details {
    margin-top: 8px;
    padding: 12px;
    background: var(--bg-color);
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }

  .progress-bar-bg {
    height: 6px;
    background: var(--border-color);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .progress-fill {
    height: 100%;
    background: var(--primary-color, #3b82f6);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.85rem;
    color: var(--secondary-text);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .progress-sub {
    font-size: 0.8rem;
    opacity: 0.8;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
