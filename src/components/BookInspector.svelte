<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Book, Chapter } from '../lib/types/book'
  // TTS worker is used by other UI components (GeneratePanel, Audio service).
  // BookInspector no longer needs to import it since preview was removed.

  let {
    book,
    selectedVoice,
    selectedQuantization,
    selectedDevice = 'auto',
    selectedModel = 'kokoro',
  } = $props<{
    book: Book
    selectedVoice: string
    selectedQuantization: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    selectedDevice?: 'auto' | 'wasm' | 'webgpu' | 'cpu'
    selectedModel?: 'kokoro' | 'piper'
  }>()

  const dispatch = createEventDispatcher()

  // Map of chapter id -> selected
  let selected = $state(new Map<string, boolean>())

  // No preview playback state here anymore; preview removed to avoid
  // duplicate controls and keep UI simple.

  // initialize selections when book changes
  $effect(() => {
    if (book) {
      // Use untracked to prevent circular dependency if needed, but here we just need to ensure
      // we don't read 'selected' in a way that triggers this effect again.
      // Actually, 'selected' is a dependency, but we only want to run this when 'book' changes.
      // In Svelte 5, we should be careful.
      // Better approach: derive initial state or just run once when book changes.

      // However, since we want to preserve selection if possible or reset it,
      // we should probably just recreate the map based on the new book.

      const newMap = new Map<string, boolean>()
      for (const ch of book.chapters) {
        // default: selected
        // We use untracked to avoid re-running when 'selected' changes
        newMap.set(ch.id, true)
      }
      selected = newMap

      // Nothing else to clear here
    }
  })

  function toggleChapter(id: string) {
    selected.set(id, !selected.get(id))
    // trigger reactivity - NOT NEEDED in Svelte 5 with $state(Map)
    // selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function selectAll() {
    for (const k of selected.keys()) selected.set(k, true)
    // selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function deselectAll() {
    for (const k of selected.keys()) selected.set(k, false)
    // selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function exportSelected() {
    const selectedChapters: Chapter[] = book.chapters.filter((ch: Chapter) => selected.get(ch.id))
    if (selectedChapters.length === 0) {
      alert('No chapters selected')
      return
    }
    const contents = selectedChapters
      .map((c, i) => `=== ${c.title} ===\n\n${c.content}\n\n`)
      .join('\n')
    const blob = new Blob([contents], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeTitle = (book.title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    a.download = `${safeTitle}_selected.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    dispatch('export', { count: selectedChapters.length })
  }

  function copyChapterContent(ch: Chapter) {
    navigator.clipboard?.writeText(ch.content).catch(() => alert('Clipboard not available'))
  }

  // Preview functionality removed: the Read button is the single play entry point
  // and the persistent player / TextReader handle playback.

  function openReader(ch: Chapter) {
    // Dispatch event to navigate to reader view
    dispatch('readchapter', { chapter: ch })
  }
</script>

<div>
  <div class="book-meta">
    <h2>{book.title}</h2>
    {#if book.format}
      <span class="format-badge">{book.format.toUpperCase()}</span>
    {/if}
  </div>
  <p><strong>Author:</strong> {book.author}</p>
  {#if book.cover}
    <img class="cover" src={book.cover} alt="cover" />
  {/if}

  <div class="controls-bar">
    <div class="left-controls">
      <button class="text-btn" onclick={selectAll}>Select all</button>
      <span class="separator">•</span>
      <button class="text-btn" onclick={deselectAll}>Deselect all</button>
    </div>

    <div class="right-controls">
      <span class="selection-count">
        <strong>{Array.from(selected.values()).filter(Boolean).length}</strong> selected
      </span>
      <button class="primary-btn" onclick={exportSelected}> Export Selected </button>
    </div>
  </div>

  <div class="chapter-list" role="list">
    {#each book.chapters as ch}
      <div class="chapter-card" class:selected={selected.get(ch.id)} role="listitem">
        <div class="card-content">
          <label class="chapter-header">
            <input
              type="checkbox"
              class="chapter-checkbox"
              checked={selected.get(ch.id)}
              onchange={() => toggleChapter(ch.id)}
              aria-label={`Select chapter: ${ch.title}`}
            />
            <span class="chapter-title">{ch.title}</span>
          </label>
          <p class="chapter-preview">
            {ch.content.slice(0, 180)}{ch.content.length > 180 ? '…' : ''}
          </p>
        </div>

        <div class="card-actions">
          <!-- Preview button removed; Read starts playback in reader and persistent player -->
          <button
            class="action-btn"
            onclick={() => openReader(ch)}
            aria-label={`Read chapter: ${ch.title}`}
          >
            <span class="icon" aria-hidden="true">📖</span> Read
          </button>

          <button
            class="action-btn icon-only"
            onclick={() => copyChapterContent(ch)}
            title="Copy text"
            aria-label={`Copy text of chapter: ${ch.title}`}
          >
            <span aria-hidden="true">📋</span>
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .cover {
    max-width: 120px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .book-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .book-meta h2 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--text-color);
  }

  .format-badge {
    display: inline-block;
    padding: 4px 8px;
    background: var(--selected-bg);
    letter-spacing: 0.5px;
  }

  /* Controls Bar */
  .controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }
  /* Cleaned up preview styles; spin keyframes kept for other components. */
  .text-btn {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .text-btn:hover {
    background: var(--bg-color);
    color: var(--text-color);
  }

  .separator {
    color: var(--border-color);
  }

  .primary-btn {
    background: var(--primary-color);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .primary-btn:hover {
    background: var(--primary-hover);
  }

  .selection-count {
    font-size: 0.9rem;
    color: var(--secondary-text);
  }

  /* Chapter List */
  .chapter-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .chapter-card {
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
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
    padding-left: 30px; /* Align with title text */
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

  .action-btn:hover:not(:disabled) {
    background: var(--bg-color);
    border-color: var(--text-color);
    color: var(--text-color);
  }

  .action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .action-btn.icon-only {
    padding: 8px;
  }

  .action-btn .icon {
    font-size: 1.1em;
  }

  /* Preview Button States removed */

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* playing-pulse animation removed */

  /* Mobile Responsive */
  @media (max-width: 640px) {
    .controls-bar {
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
    }

    .left-controls,
    .right-controls {
      justify-content: space-between;
    }

    .chapter-card {
      flex-direction: column;
      gap: 12px;
      padding: 12px;
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
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .action-btn {
      justify-content: center;
    }
  }
</style>
