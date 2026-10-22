<script lang="ts">
  // PROTOTYPE: book detail — per-chapter model/voice/language overrides (the
  // same fields the real Chapter type carries), plus book-level actions.
  import type { Book } from '../lib/types/book'
  import { audio, MODELS, voicesFor } from './audioSim.svelte'

  let {
    book,
    onClose,
    onExport,
    onGenerate,
    onDelete,
  }: {
    book: Book
    onClose: () => void
    onExport: () => void
    onGenerate: () => void
    onDelete: () => void
  } = $props()

  const LANGUAGES = ['en', 'pt', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko']

  let duration = $derived(book.chapters.reduce((a, c) => a + audio.status(c.id).duration, 0))
  let readyN = $derived(book.chapters.filter((c) => audio.status(c.id).status === 'ready').length)

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  function overridden(c: Book['chapters'][number]): boolean {
    return !!(c.model || c.voice || (c.language && c.language !== 'auto'))
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="overlay" role="dialog" aria-label="Book details">
  <header>
    <div class="cover" aria-hidden="true">
      {#if book.cover}
        <img src={book.cover} alt="" />
      {:else}
        <span>{book.title[0]}</span>
      {/if}
    </div>
    <div class="head-body">
      <h2>{book.title}</h2>
      <p class="meta">{book.author} · {book.chapters.length} chapters · {fmtTime(duration)}</p>
      <p class="meta">
        ♪ {readyN}/{book.chapters.length} with audio · format {book.format ?? 'unknown'}
      </p>
      <div class="actions">
        <button class="btn" onclick={onGenerate}>Generate audiobook</button>
        <button class="btn ghost" onclick={onExport}>Export…</button>
        <button class="btn ghost danger" onclick={onDelete}>Remove</button>
      </div>
    </div>
    <button class="icon" onclick={onClose} aria-label="Close">✕</button>
  </header>

  <p class="note">
    Per-chapter settings win over the app defaults. “auto” keeps the book language.
  </p>

  <div class="list">
    {#each book.chapters as c (c.id)}
      <div class="row" class:custom={overridden(c)}>
        <span class="ch">
          {c.title}
          {#if overridden(c)}<span class="dot" title="Has overrides">•</span>{/if}
          <span class="st s-{audio.status(c.id).status}">{audio.status(c.id).status}</span>
        </span>
        <select aria-label="Language for {c.title}" bind:value={c.language}>
          <option value="">auto</option>
          {#each LANGUAGES as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
        <select
          aria-label="Model for {c.title}"
          bind:value={c.model}
          onchange={() => (c.voice = '')}
        >
          <option value="">app default</option>
          {#each MODELS as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
        <select aria-label="Voice for {c.title}" bind:value={c.voice}>
          <option value="">app default</option>
          {#each voicesFor(c.model ?? audio.prefs.model, c.language || audio.prefs.language) as v (v)}
            <option value={v}>{v}</option>
          {/each}
        </select>
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
    max-width: 860px;
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
    gap: 16px;
    padding: 18px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  .cover {
    width: 84px;
    height: 122px;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #a8a29e, #78716c);
    color: #fff;
    font-size: 1.8rem;
    font-weight: 700;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
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
    margin: 0 0 4px;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  .note {
    margin: 12px 20px 0;
    font-size: 0.78rem;
    color: var(--secondary-text, #78716c);
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px 2rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
  }

  .row:nth-child(odd) {
    background: var(--selected-bg, #f5f5f4);
  }

  .ch {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dot {
    color: var(--primary-color, #78716c);
    font-weight: 700;
    margin-left: 4px;
  }

  .st {
    font-size: 0.66rem;
    color: var(--secondary-text, #78716c);
    margin-left: 6px;
  }

  .st.s-ready {
    color: var(--success-color, #6b8f71);
  }

  .st.s-failed {
    color: var(--error-color, #c2847a);
  }

  .row select {
    width: 110px;
    background: var(--input-bg, #fff);
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 0.75rem;
    min-height: 32px;
  }

  .btn {
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 10px;
    padding: 9px 14px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 38px;
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

  .icon {
    background: none;
    border: none;
    color: var(--secondary-text, #78716c);
    cursor: pointer;
    padding: 8px;
    min-height: 36px;
    border-radius: 8px;
    font-size: 0.9rem;
    align-self: flex-start;
  }

  .icon:hover {
    background: var(--selected-bg, #f5f5f4);
    color: var(--text-color, #1c1917);
  }

  @media (max-width: 640px) {
    .overlay {
      inset: 8px;
    }

    .row {
      flex-wrap: wrap;
    }

    .ch {
      flex-basis: 100%;
    }

    .row select {
      flex: 1;
      width: auto;
    }
  }
</style>
