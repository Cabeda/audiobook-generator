<script lang="ts">
  // Audiobook page — everything about one book's audio: generate the whole
  // book, watch it come alive chapter by chapter, retry what failed, export.
  import type { LibraryBook } from '../lib/libraryDB'
  import { chapterErrors, chapterStatus, isGenerating } from '../stores/bookStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { reader } from './readerModel.svelte'

  let {
    book,
    onClose,
    onExport,
  }: { book: LibraryBook; onClose: () => void; onExport: () => void } = $props()

  // mirror the stores so every badge and bar updates as generation runs
  let live = $derived({
    segments: $segmentProgress,
    status: $chapterStatus,
    errors: $chapterErrors,
    running: $isGenerating,
  })

  let chIds = $derived(book.chapters.map((c) => c.id))

  let summary = $derived.by(() => {
    void live
    return {
      ready: reader.readyCount(chIds),
      generating: reader.generatingCount(chIds),
      failed: reader.failedCount(chIds),
    }
  })

  let percent = $derived.by(() => {
    void live
    return Math.round(reader.bookGeneration.percent * 100)
  })

  function stateOf(id: string) {
    void live
    return reader.statusOf(id)
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="overlay" role="dialog" aria-label="Audiobook">
  <header>
    <div class="head-body">
      <h2>{book.title}</h2>
      <p class="meta">{book.author} · {book.chapters.length} chapters</p>
    </div>
    <button class="icon" onclick={onClose} aria-label="Close">✕</button>
  </header>

  <div class="summary">
    <div class="summary-row">
      <span class="pct">{percent}%</span>
      <div class="bar"><div class="fill" style="width: {percent}%"></div></div>
    </div>
    <p class="meta">
      {summary.ready} of {book.chapters.length} chapters with audio{#if summary.generating > 0}
        · generating {summary.generating}{/if}{#if summary.failed > 0}
        · {summary.failed} failed{/if}
    </p>
    <div class="actions">
      <button class="btn" onclick={() => void reader.generateMissing()}>
        {summary.generating > 0
          ? `Generating… (${summary.generating} left)`
          : summary.ready === book.chapters.length
            ? 'Regenerate audiobook'
            : 'Generate audiobook'}
      </button>
      <button class="btn ghost" onclick={onExport}>Export…</button>
      {#if summary.failed > 0}
        <button class="btn ghost danger" onclick={() => void reader.retry(chIds)}
          >Retry {summary.failed} failed</button
        >
      {/if}
    </div>
  </div>

  <div class="list">
    {#each book.chapters as c (c.id)}
      <div class="row">
        <span class="ch">{c.title}</span>
        <span class="pill s-{stateOf(c.id).state}">
          {stateOf(c.id).state === 'none' ? 'not generated' : stateOf(c.id).state}
        </span>
        <div class="mini-bar">
          <div class="mini-fill" style="width: {stateOf(c.id).progress * 100}%"></div>
        </div>
        {#if stateOf(c.id).state === 'failed'}
          <button class="mini-btn" onclick={() => void reader.retry([c.id])}>Retry</button>
        {:else if stateOf(c.id).state === 'none'}
          <button class="mini-btn" onclick={() => void reader.generate([c.id])}>Generate</button>
        {:else}
          <button class="mini-btn" onclick={() => void reader.play(c)} aria-label="Play {c.title}"
            >▶</button
          >
        {/if}
      </div>
    {/each}
  </div>
</section>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 60;
  }

  .overlay {
    position: fixed;
    inset: 24px;
    z-index: 61;
    max-width: 720px;
    margin: 0 auto;
    background: var(--bg-color, #faf9f7);
    color: var(--text-color, #1c1917);
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  .head-body {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
  }

  .meta {
    margin: 0;
    color: var(--secondary-text, #78716c);
    font-size: 0.82rem;
  }

  .summary {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .pct {
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 3ch;
  }

  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--border-color, #e7e5e4);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--success-color, #6b8f71);
    transition: width 0.3s ease;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }

  .btn {
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 10px;
    padding: 10px 16px;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 42px;
  }

  .btn.ghost {
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    font-weight: 500;
  }

  .btn.danger {
    color: var(--error-color, #c2847a);
    border-color: var(--error-border, #e8c4be);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px 2rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
    font-size: 0.85rem;
  }

  .ch {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill {
    font-size: 0.7rem;
    border-radius: 999px;
    padding: 2px 9px;
    background: var(--selected-bg, #f5f5f4);
    color: var(--secondary-text, #78716c);
    white-space: nowrap;
  }

  .pill.s-ready {
    color: var(--success-color, #6b8f71);
    font-weight: 600;
  }

  .pill.s-generating {
    color: var(--primary-color, #78716c);
    font-weight: 600;
  }

  .pill.s-failed {
    background: var(--error-bg, #fdf2f0);
    color: var(--error-color, #c2847a);
    font-weight: 600;
  }

  .mini-bar {
    width: 70px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-color, #e7e5e4);
    overflow: hidden;
  }

  .mini-fill {
    height: 100%;
    background: var(--success-color, #6b8f71);
    transition: width 0.3s ease;
  }

  .mini-btn {
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 8px;
    padding: 5px 11px;
    font-size: 0.75rem;
    cursor: pointer;
    min-height: 32px;
    min-width: 44px;
    white-space: nowrap;
  }

  .mini-btn:hover {
    background: var(--selected-bg, #f5f5f4);
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: var(--secondary-text, #78716c);
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
    border-radius: 10px;
    font-size: 1.05rem;
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .overlay {
      inset: 8px;
    }

    .mini-bar {
      display: none;
    }
  }
</style>
