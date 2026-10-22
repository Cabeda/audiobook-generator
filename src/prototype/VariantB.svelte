<script lang="ts">
  // PROTOTYPE variant B "Shelf": a cover-forward home shelf and an e-reader that
  // pages horizontally through the whole book. The audio dock follows you around.
  import type { Book } from '../lib/types/book'
  import { loadBook } from '../lib/bookLoader'
  import { audio, MODELS, voicesFor, EXPORT_FORMATS } from './audioSim.svelte'

  let {
    books,
    ui,
  }: { books: Book[]; ui: { bookIndex: number; chapterIndex: number; progress: number } } = $props()

  const GAP = 48 // must match column-gap below: page pitch = clientWidth + GAP

  let screen = $state<'home' | 'reader'>('home')
  let dockOpen = $state(false)
  let pageW = $state(0)

  let book = $derived(books[ui.bookIndex])
  let chIds = $derived((book?.chapters ?? []).map((c) => c.id))
  let scroller: HTMLElement | undefined = $state()
  let flow: HTMLElement | undefined = $state()

  function openBook(i: number, resume = false) {
    if (i !== ui.bookIndex) {
      ui.bookIndex = i
      ui.chapterIndex = 0
      ui.progress = 0
    }
    screen = 'reader'
    if (!resume) ui.chapterIndex = 0
    requestAnimationFrame(() => {
      if (resume && ui.chapterIndex > 0) jumpToChapter(ui.chapterIndex)
      else scroller?.scrollTo({ left: 0 })
      track()
    })
  }

  function page(dir: 1 | -1) {
    scroller?.scrollBy({ left: dir * (scroller.clientWidth + GAP), behavior: 'smooth' })
  }

  function onScroll() {
    const el = scroller!
    const max = el.scrollWidth - el.clientWidth
    ui.progress = max > 0 ? el.scrollLeft / max : 0
    track()
  }

  function track() {
    const el = scroller
    const fl = flow
    if (!el || !fl) return
    const left = el.getBoundingClientRect().left
    let idx = 0
    fl.querySelectorAll<HTMLElement>('[data-chapter]').forEach((m, i) => {
      if (m.getBoundingClientRect().left <= left + 40) idx = i
    })
    ui.chapterIndex = idx
  }

  function jumpToChapter(i: number) {
    const el = scroller
    const fl = flow
    const m = fl?.querySelector<HTMLElement>(`[data-chapter="${i}"]`)
    if (!el || !fl || !m) return
    ui.chapterIndex = i
    const target = m.getBoundingClientRect().left - fl.getBoundingClientRect().left + el.scrollLeft
    el.scrollTo({ left: target, behavior: 'smooth' })
    dockOpen = false
  }

  function onTap(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - r.left
    if (x > r.width * 0.32 && x < r.width * 0.68) {
      dockOpen = !dockOpen
      return
    }
    page(x <= r.width * 0.32 ? -1 : 1)
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (screen !== 'reader') return
    if (e.shiftKey && e.key === 'ArrowRight') page(1)
    else if (e.shiftKey && e.key === 'ArrowLeft') page(-1)
    else if (e.key === 'Escape') screen = 'home'
  }

  function progressOf(i: number) {
    // crude per-book placeholder: only the current book has a known position
    return i === ui.bookIndex ? ui.progress : 0
  }

  let heroPct = $derived(Math.round(ui.progress * 100))
  let audioPct = $derived(
    book?.chapters.length ? Math.round((audio.readyCount(chIds) / book.chapters.length) * 100) : 0
  )

  // ---- audiobook generation / playback (stubbed pipeline) ----
  function fmt(s: number) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  function listenNow() {
    audio.play(book.chapters[ui.chapterIndex]?.id)
    screen = 'reader'
    dockOpen = true
  }

  function togglePlay() {
    // dock plays whatever is loaded; if nothing is, it starts the current chapter
    if (audio.chapterId) audio.toggle()
    else audio.play(book.chapters[ui.chapterIndex]?.id)
  }

  async function onImport(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    const b = await loadBook(f)
    books.push(b) // prototype: memory only
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shelf">
  {#if screen === 'home'}
    <div class="home">
      <header class="home-head">
        <h1>Shelf</h1>
        <span class="count">{books.length} books</span>
      </header>

      {#if book}
        <section class="hero">
          <div class="hero-cover" aria-hidden="true">
            {#if book.cover}
              <img src={book.cover} alt="" />
            {:else}
              <span>{book.title[0]}</span>
            {/if}
          </div>
          <div class="hero-body">
            <p class="kicker">{heroPct > 0 ? `Continue · ${heroPct}%` : 'Start reading'}</p>
            <h2>{book.title}</h2>
            <p class="author">{book.author}</p>
            <div class="mini-bar"><div class="mini-fill" style="width: {heroPct}%"></div></div>
            <div class="mini-bar">
              <div class="mini-fill audio" style="width: {audioPct}%"></div>
            </div>
            <div class="cta-row">
              <button class="cta" onclick={() => openBook(ui.bookIndex, true)}>
                {heroPct > 0 ? 'Continue reading' : 'Start reading'} →
              </button>
              <button class="cta ghost-cta" onclick={listenNow}>
                ▶ {audioPct > 0 ? `Listen · ${audioPct}%` : 'Listen'}
              </button>
            </div>
          </div>
        </section>
      {/if}

      <h3 class="list-title">Your books</h3>
      <ul class="book-list">
        {#each books as b, i (b.title)}
          <li>
            <button class="row" onclick={() => openBook(i)}>
              <div class="thumb" aria-hidden="true">
                {#if b.cover}
                  <img src={b.cover} alt="" />
                {:else}
                  <span>{b.title[0]}</span>
                {/if}
              </div>
              <div class="row-body">
                <span class="row-title">{b.title}</span>
                <span class="row-meta">{b.author} · {b.chapters.length} chapters</span>
                <div class="mini-bar">
                  <div class="mini-fill" style="width: {progressOf(i) * 100}%"></div>
                </div>
              </div>
            </button>
          </li>
        {/each}
      </ul>

      <label class="import"
        >＋ Import book
        <input
          type="file"
          hidden
          accept=".epub,.pdf,.txt,.md,.html"
          onchange={(e) =>
            onImport(
              (e.currentTarget as HTMLSelectElement) && (e.currentTarget as HTMLInputElement).files
            )}
        />
      </label>
    </div>
  {:else}
    <div class="reader-top">
      <button class="ghost" onclick={() => (screen = 'home')}>← Shelf</button>
      <span class="reader-title">{book.title}</span>
      <span class="reader-ch">{book.chapters[ui.chapterIndex]?.title}</span>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="pages"
      bind:this={scroller}
      bind:clientWidth={pageW}
      onscroll={onScroll}
      onclick={onTap}
      role="document"
      aria-label="Paged book content"
    >
      <div class="flow" bind:this={flow} style="column-width: {Math.max(pageW, 1)}px">
        {#each book.chapters as chapter, i (chapter.id)}
          <h2 class="chapter-mark" data-chapter={i}>{chapter.title}</h2>
          {@html chapter.content}
        {/each}
      </div>
    </div>

    <button class="tap-hint left" onclick={() => page(-1)} aria-label="Previous page">‹</button>
    <button class="tap-hint right" onclick={() => page(1)} aria-label="Next page">›</button>

    {#if dockOpen}
      <div class="sheet">
        <h4>Listen</h4>
        <div class="speeds">
          {#each [1, 1.25, 1.5, 2] as r (r)}
            <button
              class="chip"
              class:active={audio.prefs.rate === r}
              onclick={() => (audio.prefs.rate = r)}>{r}×</button
            >
          {/each}
          <select
            aria-label="TTS model"
            bind:value={audio.prefs.model}
            onchange={() =>
              (audio.prefs.voice = voicesFor(audio.prefs.model, audio.prefs.language)[0])}
          >
            {#each MODELS as m (m)}
              <option value={m}>{m}</option>
            {/each}
          </select>
          <select aria-label="Voice" bind:value={audio.prefs.voice}>
            {#each voicesFor(audio.prefs.model, audio.prefs.language) as v (v)}
              <option value={v}>{v}</option>
            {/each}
          </select>
        </div>
        <div class="speeds">
          <button class="chip" onclick={() => audio.generate(chIds)}>
            Generate audiobook ({audio.readyCount(chIds)}/{book.chapters.length})
          </button>
          <select aria-label="Export format" bind:value={audio.prefs.exportFormat}>
            {#each EXPORT_FORMATS as f (f)}
              <option value={f}>{f}</option>
            {/each}
          </select>
          <button class="chip" onclick={() => audio.export()}>
            {audio.exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
        <h4>Chapters</h4>
        <ul>
          {#each book.chapters as c, i (c.id)}
            <li>
              <button
                class="sheet-item"
                class:current={i === ui.chapterIndex}
                onclick={() => jumpToChapter(i)}
              >
                {c.title}
              </button>
              <button class="chip" onclick={() => audio.play(c.id)} aria-label="Play chapter">
                {#if audio.status(c.id).status === 'generating'}
                  ↻ {Math.round(audio.status(c.id).progress * 100)}%
                {:else if audio.status(c.id).status === 'queued'}…
                {:else if audio.chapterId === c.id && audio.playing}
                  ❚❚
                {:else}
                  ▶
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="dock">
      <div class="dock-cover" aria-hidden="true">{book.title[0]}</div>
      <div class="dock-meta">
        <span class="dock-title">
          {audio.chapterId
            ? (book.chapters.find((c) => c.id === audio.chapterId)?.title ?? book.title)
            : book.title}
        </span>
        <span class="dock-ch">
          {#if audio.chapterId}
            {audio.playing ? 'Playing' : 'Paused'} · {fmt(audio.position)} / {fmt(audio.duration)}
          {:else}
            {book.chapters[ui.chapterIndex]?.title}
          {/if}
        </span>
      </div>
      <div class="dock-bar">
        <div
          class="dock-fill"
          style="width: {audio.chapterId
            ? (audio.position / (audio.duration || 1)) * 100
            : ui.progress * 100}%"
        ></div>
      </div>
      <button class="play" onclick={togglePlay} aria-label="Play or pause">
        {audio.playing ? '❚❚' : '▶'}
      </button>
      <button class="ghost" onclick={() => (dockOpen = !dockOpen)} aria-label="Expand player">
        {dockOpen ? '▾' : '▴'}
      </button>
    </div>
  {/if}
</div>

<style>
  .shelf {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-color);
    color: var(--text-color);
    overflow: hidden;
  }

  /* ---------- home ---------- */
  .home {
    flex: 1;
    overflow-y: auto;
    padding: 28px 22px 8rem;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }

  .home-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 22px;
  }

  .home-head h1 {
    font-size: 1.65rem;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .count {
    color: var(--secondary-text);
    font-size: 0.82rem;
  }

  .hero {
    display: flex;
    gap: 18px;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 18px;
    padding: 18px;
    box-shadow: 0 10px 30px var(--shadow-color);
    margin-bottom: 30px;
  }

  .hero-cover {
    width: 108px;
    height: 158px;
    border-radius: 10px;
    overflow: hidden;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #78716c, #44403c);
    color: #fff;
    font-size: 2.4rem;
    font-weight: 700;
  }

  .hero-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hero-body {
    flex: 1;
    min-width: 0;
  }

  .kicker {
    margin: 0 0 6px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text);
  }

  .hero h2 {
    margin: 0;
    font-size: 1.3rem;
    letter-spacing: -0.01em;
  }

  .author {
    margin: 2px 0 12px;
    color: var(--secondary-text);
    font-size: 0.9rem;
  }

  .mini-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--border-color);
    overflow: hidden;
    margin-bottom: 14px;
  }

  .mini-fill {
    height: 100%;
    background: var(--primary-color);
  }

  .cta {
    background: var(--text-color);
    color: var(--bg-color);
    border: none;
    border-radius: 12px;
    padding: 12px 20px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 44px;
  }

  .cta:hover {
    opacity: 0.85;
  }

  .list-title {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text);
    margin: 0 0 10px;
  }

  .book-list {
    list-style: none;
    margin: 0 0 26px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    background: none;
    border: none;
    border-radius: 12px;
    padding: 10px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }

  .row:hover {
    background: var(--surface-color);
  }

  .thumb {
    width: 42px;
    height: 58px;
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #a8a29e, #78716c);
    color: #fff;
    font-weight: 700;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .row-body {
    flex: 1;
    min-width: 0;
  }

  .row-title {
    display: block;
    font-weight: 600;
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-meta {
    display: block;
    color: var(--secondary-text);
    font-size: 0.78rem;
    margin: 2px 0 6px;
  }

  .import {
    width: 100%;
    background: none;
    border: 1px dashed var(--border-color);
    color: var(--secondary-text);
    border-radius: 12px;
    padding: 14px;
    cursor: pointer;
    font-size: 0.9rem;
    min-height: 44px;
  }

  /* ---------- reader ---------- */
  .reader-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--surface-color);
  }

  .reader-title {
    font-weight: 600;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reader-ch {
    color: var(--secondary-text);
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ghost {
    background: none;
    border: none;
    color: var(--secondary-text);
    cursor: pointer;
    font-size: 0.88rem;
    padding: 8px 10px;
    min-height: 36px;
    border-radius: 8px;
  }

  .ghost:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
  }

  .pages {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    max-width: 860px;
    width: 100%;
    margin: 0 auto;
    cursor: pointer;
  }

  .flow {
    height: 100%;
    column-gap: 48px;
    column-fill: auto;
    padding: 34px 0 96px;
  }

  .flow :global(p) {
    margin: 0 0 1em;
    line-height: 1.8;
    font-size: 1.05rem;
  }

  .chapter-mark {
    font-size: 1.25rem;
    margin: 0 0 1.2em;
    break-before: column;
    break-after: avoid;
    break-inside: avoid;
    letter-spacing: -0.01em;
  }

  .chapter-mark:first-child {
    break-before: auto;
  }

  .tap-hint {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--secondary-text);
    font-size: 2.2rem;
    cursor: pointer;
    padding: 20px 12px;
    opacity: 0;
  }

  .tap-hint.left {
    left: 0;
  }

  .tap-hint.right {
    right: 0;
  }

  .shelf:hover .tap-hint {
    opacity: 0.55;
  }

  /* ---------- dock + sheet ---------- */
  .dock {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    /* shortcut: raised to clear the prototype switcher pill, drop to 14px when folded in */
    bottom: calc(70px + env(safe-area-inset-bottom));
    width: min(560px, calc(100% - 28px));
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 8px 12px 8px 8px;
    box-shadow: 0 14px 34px var(--shadow-color);
  }

  .dock-cover {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #78716c, #44403c);
    color: #fff;
    font-weight: 700;
    flex-shrink: 0;
  }

  .dock-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .dock-title {
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dock-ch {
    font-size: 0.72rem;
    color: var(--secondary-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dock-bar {
    width: 80px;
    height: 3px;
    border-radius: 2px;
    background: var(--border-color);
    overflow: hidden;
  }

  .dock-fill {
    height: 100%;
    background: var(--primary-color);
  }

  .play {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: var(--text-color);
    color: var(--bg-color);
    cursor: pointer;
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .sheet {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(136px + env(safe-area-inset-bottom));
    width: min(560px, calc(100% - 28px));
    max-height: 52vh;
    overflow-y: auto;
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: 18px;
    padding: 16px;
    box-shadow: 0 14px 34px var(--shadow-color);
    z-index: 5;
  }

  .sheet h4 {
    margin: 0 0 10px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text);
  }

  .sheet ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .sheet-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.9rem;
    min-height: 40px;
  }

  .sheet-item:hover {
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
  }

  .sheet-item.current {
    font-weight: 700;
  }

  .cta-row {
    display: flex;
    gap: 8px;
  }

  .ghost-cta {
    background: none;
    color: var(--text-color);
    border: 1px solid var(--border-color);
  }

  .mini-fill.audio {
    background: var(--success-color, #6b8f71);
  }

  .speeds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
    align-items: center;
  }

  .chip {
    background: none;
    border: 1px solid var(--border-color);
    color: inherit;
    border-radius: 999px;
    padding: 7px 12px;
    font-size: 0.78rem;
    cursor: pointer;
    min-height: 34px;
    white-space: nowrap;
  }

  .chip.active {
    background: var(--text-color);
    color: var(--bg-color);
    border-color: var(--text-color);
  }

  .speeds select {
    background: none;
    border: 1px solid var(--border-color);
    color: inherit;
    border-radius: 999px;
    padding: 7px 10px;
    font-size: 0.78rem;
    min-height: 34px;
  }

  .sheet li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sheet li .sheet-item {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
