<script lang="ts">
  // Book detail — per-chapter model/voice/language overrides (the same fields
  // the real Chapter type carries), plus book-level actions. Overrides are
  // persisted through the book session as they are applied.
  import type { Chapter } from '../lib/types/book'
  import type { LibraryBook } from '../lib/libraryDB'
  import { setChapterOverride, type ChapterOverride } from '../lib/services/bookSession'
  import { MODEL_OPTIONS, voiceOptionsFor, type SelectedModel } from '../lib/tts/ttsModels'
  import { chapterErrors, chapterStatus } from '../stores/bookStore'
  import { piperVoices } from '../stores/piperVoicesStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { reader } from './readerModel.svelte'

  let {
    book,
    onClose,
    onExport,
    onGenerate,
    onDelete,
  }: {
    book: LibraryBook
    onClose: () => void
    onExport: () => void
    onGenerate: () => void
    onDelete: () => void
  } = $props()

  const LANGUAGES = ['en', 'pt', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'ru', 'ja', 'zh', 'ko']

  /** One chapter's audio state, read live as generation progresses. */
  function status(id: string) {
    // The bridge reads the generation stores with get(); read them here so the
    // list tracks live progress.
    void [$segmentProgress, $chapterStatus, $chapterErrors]
    return reader.statusOf(id)
  }

  /** Voices a row may pick from, for its model and language. */
  function voiceOptions(model: string | undefined, language: string | undefined) {
    return voiceOptionsFor(
      (model ?? reader.prefs.model) as SelectedModel,
      language || 'en',
      $piperVoices
    )
  }

  // Duration is estimated from word counts (~2.6 words per spoken second).
  let duration = $derived(
    Math.round(
      book.chapters.reduce(
        (a, c) => a + c.content.replace(/<[^>]+>/g, ' ').split(/\s+/).length,
        0
      ) / 2.6
    )
  )
  let readyN = $derived(book.chapters.filter((c) => status(c.id).state === 'ready').length)

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  function overridden(c: Chapter): boolean {
    return !!(c.model || c.voice || (c.language && c.language !== 'auto'))
  }

  /** Persist one changed field; the session mirrors it back into the chapter. */
  function save(chapterId: string, override: ChapterOverride) {
    setChapterOverride(book, chapterId, override).catch((e) => console.error(e))
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
          <span class="st s-{status(c.id).state}">{status(c.id).state}</span>
        </span>
        <select
          aria-label="Language for {c.title}"
          bind:value={c.language}
          onchange={(e) => save(c.id, { language: e.currentTarget.value })}
        >
          <option value="">auto</option>
          {#each LANGUAGES as l (l)}
            <option value={l}>{l}</option>
          {/each}
        </select>
        <select
          aria-label="Model for {c.title}"
          bind:value={c.model}
          onchange={(e) => save(c.id, { model: e.currentTarget.value })}
        >
          <option value="">app default</option>
          {#each MODEL_OPTIONS as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
        <select
          aria-label="Voice for {c.title}"
          bind:value={c.voice}
          onchange={(e) => save(c.id, { voice: e.currentTarget.value })}
        >
          <option value="">app default</option>
          {#each voiceOptions(c.model, c.language) as v (v.id)}
            <option value={v.id}>{v.label}</option>
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
