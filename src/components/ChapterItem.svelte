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
  } = $props<{
    chapter: Chapter
    selected?: boolean
    audioData?: { url: string; blob: Blob }
    onToggle: (id: string) => void
    onRead: (chapter: Chapter) => void
    onDownloadWav: (id: string) => void
    onDownloadMp3: (id: string) => void
  }>()

  function copy() {
    navigator.clipboard?.writeText(chapter.content).catch(() => alert('Clipboard not available'))
  }
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
      <button
        class="action-btn"
        onclick={() => onRead(chapter)}
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

  {#if audioData}
    <div class="audio-controls">
      <audio controls src={audioData.url} aria-label={`Audio for ${chapter.title}`}></audio>
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
</style>
