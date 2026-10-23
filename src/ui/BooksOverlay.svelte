<script lang="ts">
  // Books page — browse, search and manage the library. Designed to stay
  // usable at hundreds of books (search + sort + compact grid).
  import type { LibraryBook } from '../lib/libraryDB'
  import { chapterErrors, chapterStatus } from '../stores/bookStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { reader } from './readerModel.svelte'
  import { loadPosition } from '../stores/readerPositionStore'

  let {
    books,
    ui,
    onOpen,
    onListen,
    onDelete,
    onImport,
    onDetails,
    onAudiobook,
    onActivity,
    onSettings,
    onClose,
  }: {
    books: LibraryBook[]
    ui: { bookIndex: number; chapterIndex: number; progress: number }
    onOpen: (i: number) => void
    onListen: (i: number) => void
    onDelete: (i: number) => void
    onImport: () => void
    onDetails: (i: number) => void
    onAudiobook: (i: number) => void
    onActivity: () => void
    onSettings: () => void
    onClose: () => void
  } = $props()

  let query = $state('')
  let sort = $state<'added' | 'title' | 'author'>('added')
  let menuFor = $state<number | null>(null)

  let listed = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const rows = books
      .map((b, i) => ({ b, i }))
      .filter(
        ({ b }) => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q)
      )
    if (sort === 'title') rows.sort((x, y) => x.b.title.localeCompare(y.b.title))
    else if (sort === 'author')
      rows.sort(
        (x, y) => x.b.author.localeCompare(y.b.author) || x.b.title.localeCompare(y.b.title)
      )
    else rows.reverse() // newest added first
    return rows
  })

  function readyPct(b: LibraryBook) {
    // The bridge reads the generation stores with get(); read them here so the
    // percentages track live progress.
    void [$segmentProgress, $chapterStatus, $chapterErrors]
    const n = b.chapters.length || 1
    return Math.round((reader.readyCount(b.chapters.map((c) => c.id)) / n) * 100)
  }

  function readPct(b: LibraryBook) {
    const saved = loadPosition(b.id ?? null)
    return saved ? Math.round(saved.scrollFraction * 100) : 0
  }
</script>

<svelte:window onclick={() => (menuFor = null)} />

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="overlay" role="dialog" aria-label="Books">
  <header>
    <h2>Books <span class="count">{books.length}</span></h2>
    <div class="controls">
      <input bind:value={query} placeholder="Search title or author…" aria-label="Search books" />
      <select bind:value={sort} aria-label="Sort books">
        <option value="added">Newest</option>
        <option value="title">Title</option>
        <option value="author">Author</option>
      </select>
      <button class="icon" onclick={onActivity} aria-label="Generation activity">♪</button>
      <button class="icon" onclick={onSettings} aria-label="App settings">⚙</button>
      <button class="btn" onclick={onImport}>＋ Import</button>
      <button class="icon" onclick={onClose} aria-label="Close">✕</button>
    </div>
  </header>

  {#if listed.length === 0}
    <p class="empty">No books match “{query}”.</p>
  {:else}
    <div class="grid">
      {#each listed as { b, i } (i)}
        <article class="card" class:current={i === ui.bookIndex}>
          <button class="cover" onclick={() => onOpen(i)} aria-label="Open {b.title}">
            {#if b.cover}
              <img src={b.cover} alt="" />
            {:else}
              <span>{b.title[0]}</span>
            {/if}
          </button>
          <h3>{b.title}</h3>
          <p class="meta">{b.author}</p>
          <p class="meta">
            {b.chapters.length} chapters · ♪ {readyPct(b)}%{readPct(b) > 0
              ? ` · read ${readPct(b)}%`
              : ''}
          </p>
          <div class="actions">
            <button
              class="icon more"
              aria-label="More actions for {b.title}"
              aria-expanded={menuFor === i}
              onclick={(e) => {
                e.stopPropagation()
                menuFor = menuFor === i ? null : i
              }}
            >
              ⋮
            </button>
            {#if menuFor === i}
              <div class="menu" role="menu">
                <button
                  role="menuitem"
                  onclick={() => {
                    menuFor = null
                    onOpen(i)
                  }}>Read</button
                >
                <button
                  role="menuitem"
                  onclick={() => {
                    menuFor = null
                    onListen(i)
                  }}>▶ Listen</button
                >
                <button
                  role="menuitem"
                  onclick={() => {
                    menuFor = null
                    onDetails(i)
                  }}>Details</button
                >
                <button
                  role="menuitem"
                  onclick={() => {
                    menuFor = null
                    onAudiobook(i)
                  }}>♪ Audiobook</button
                >
                <button
                  role="menuitem"
                  class="danger"
                  onclick={() => {
                    menuFor = null
                    onDelete(i)
                  }}>Remove</button
                >
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
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
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
    flex-wrap: wrap;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .count {
    color: var(--secondary-text, #78716c);
    font-size: 0.85rem;
    font-weight: 400;
  }

  .controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  input,
  select {
    border: 1px solid var(--border-color, #e7e5e4);
    background: var(--input-bg, #fff);
    color: inherit;
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 0.85rem;
    min-height: 40px;
  }

  input {
    width: 220px;
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
    min-height: 40px;
    white-space: nowrap;
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
  }

  .icon:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
    color: var(--text-color, #1c1917);
  }

  .grid {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 18px;
    align-content: start;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card.current h3 {
    color: var(--primary-color, #78716c);
  }

  .cover {
    width: 100%;
    aspect-ratio: 2 / 3;
    border-radius: 10px;
    overflow: hidden;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #a8a29e, #78716c);
    color: #fff;
    font-size: 2.2rem;
    font-weight: 700;
    margin-bottom: 6px;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  h3 {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .meta {
    margin: 0;
    color: var(--secondary-text, #78716c);
    font-size: 0.72rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .actions {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    margin-top: auto; /* buttons line up at the card bottom whatever the title does */
    padding-top: 6px;
  }

  .icon.more {
    min-width: 36px;
    min-height: 36px;
    font-size: 1.15rem;
    border: none;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    padding: 6px;
    background: var(--surface-color, #fff);
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 12px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  }

  .menu button {
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 40px;
    white-space: nowrap;
  }

  .menu button:hover {
    background: var(--selected-bg, #f5f5f4);
  }

  .menu button.danger {
    color: var(--error-color, #c2847a);
  }

  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--secondary-text, #78716c);
  }

  @media (max-width: 640px) {
    .overlay {
      inset: 8px;
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      padding: 14px;
      gap: 12px;
    }

    input {
      width: 140px;
    }
  }
</style>
