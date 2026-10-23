<script lang="ts">
  // PROTOTYPE variant C "Split": no navigation at all. Books and chapters live in
  // a permanent rail; the reading pane just scrolls. j/k jump chapters, / searches.
  import type { Book } from '../lib/types/book'
  import { loadBook } from '../lib/bookLoader'
  import { audio, MODELS, voicesFor, EXPORT_FORMATS } from './audioSim.svelte'

  let {
    books,
    ui,
  }: { books: Book[]; ui: { bookIndex: number; chapterIndex: number; progress: number } } = $props()

  const THEMES = ['light', 'dark'] as const

  let theme = $state<(typeof THEMES)[number]>('light')
  let railOpen = $state(true)
  let settingsOpen = $state(false)
  let query = $state('')
  let fontSize = $state(17)

  let book = $derived(books[ui.bookIndex])
  let chIds = $derived((book?.chapters ?? []).map((c) => c.id))
  let pane: HTMLElement | undefined = $state()
  let searchInput: HTMLElement | undefined = $state()

  let matches = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return (book?.chapters ?? []).map((c) => {
      const inTitle = c.title.toLowerCase().includes(q)
      const hits = inTitle ? 1 : (c.content.toLowerCase().split(q).length ?? 1) - 1
      return hits
    })
  })

  function onScroll() {
    const el = pane!
    const max = el.scrollHeight - el.clientHeight
    ui.progress = max > 0 ? el.scrollTop / max : 0
    let idx = 0
    const top = el.getBoundingClientRect().top
    el.querySelectorAll<HTMLElement>('[data-chapter]').forEach((m, i) => {
      if (m.getBoundingClientRect().top <= top + 120) idx = i
    })
    ui.chapterIndex = idx
  }

  function goToChapter(i: number) {
    ui.chapterIndex = i
    pane
      ?.querySelector(`[data-chapter="${i}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    if (typing) {
      if (e.key === 'Escape') (t as HTMLElement).blur()
      return
    }
    if (e.key === 'j') goToChapter(Math.min(ui.chapterIndex + 1, (book?.chapters ?? []).length - 1))
    else if (e.key === 'k') goToChapter(Math.max(ui.chapterIndex - 1, 0))
    else if (e.key === '/') {
      e.preventDefault()
      searchInput?.focus()
    } else if (e.key === 't') theme = theme === 'light' ? 'dark' : 'light'
  }

  // ---- audiobook generation / playback (stubbed pipeline) ----
  function fmt(s: number) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  function playChapter(id: string) {
    if (audio.chapterId === id) audio.toggle()
    else audio.play(id)
  }

  async function onImport(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    const b = await loadBook(f)
    books.push(b) // prototype: memory only
    ui.bookIndex = books.length - 1
    ui.chapterIndex = 0
    pane?.scrollTo({ top: 0 })
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="split theme-{theme}">
  {#if book}
    <aside class="rail" class:open={railOpen}>
      <div class="rail-head">
        <select
          class="book-select"
          aria-label="Book"
          value={ui.bookIndex}
          onchange={(e) => {
            ui.bookIndex = Number((e.currentTarget as HTMLSelectElement).value)
            ui.chapterIndex = 0
            pane?.scrollTo({ top: 0 })
          }}
        >
          {#each books as b, i (b.title)}
            <option value={i}>{b.title}</option>
          {/each}
        </select>
        <label class="icon" title="Import book (memory only)">
          ＋
          <input
            type="file"
            hidden
            accept=".epub,.pdf,.txt,.md,.html"
            onchange={(e) => onImport((e.currentTarget as HTMLInputElement).files)}
          />
        </label>
        <button class="icon rail-close" onclick={() => (railOpen = false)} aria-label="Hide rail"
          >✕</button
        >
      </div>

      <div class="search">
        <input
          bind:this={searchInput}
          bind:value={query}
          placeholder="Search chapters…  ( / )"
          aria-label="Search chapters"
        />
        {#if matches}
          <span class="hits">{matches.reduce((a, b) => a + b, 0)} hits</span>
        {/if}
      </div>

      <nav class="chapters">
        {#each book.chapters as c, i (c.id)}
          {#if !matches || matches[i] > 0}
            <div class="chapter-row">
              <button
                class="chapter"
                class:current={i === ui.chapterIndex}
                onclick={() => goToChapter(i)}
              >
                <span class="tick" class:read={i < ui.chapterIndex}></span>
                <span class="ch-title">{c.title}</span>
                {#if matches}<span class="ch-hits">{matches[i]}</span>{/if}
              </button>
              <button
                class="gen"
                class:ready={audio.status(c.id).status === 'ready'}
                onclick={() => playChapter(c.id)}
                aria-label="Generate and play {c.title}"
              >
                {#if audio.status(c.id).status === 'generating'}
                  {Math.round(audio.status(c.id).progress * 100)}%
                {:else if audio.status(c.id).status === 'queued'}
                  …
                {:else if audio.chapterId === c.id && audio.playing}
                  ❚❚
                {:else if audio.status(c.id).status === 'ready'}
                  ▶
                {:else}
                  ＋
                {/if}
              </button>
            </div>
          {/if}
        {/each}
      </nav>

      <footer class="rail-foot">
        <span>{ui.chapterIndex + 1} / {book.chapters.length}</span>
        <span>♪ {audio.readyCount(chIds)}/{book.chapters.length}</span>
        <span>{Math.round(ui.progress * 100)}%</span>
      </footer>
      <div class="rail-actions">
        <button class="action" onclick={() => audio.generate(chIds)}>
          {audio.generatingCount(chIds) > 0
            ? `Generating… ${audio.generatingCount(chIds)} left`
            : 'Generate audiobook'}
        </button>
        <button class="action" onclick={() => audio.export()}>
          {audio.exporting ? 'Exporting…' : `Export ${audio.prefs.exportFormat}`}
        </button>
      </div>
    </aside>

    {#if railOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="rail-scrim" onclick={() => (railOpen = false)}></div>
    {/if}

    <main class="pane-wrap">
      <header class="toolbar">
        <button class="icon" onclick={() => (railOpen = !railOpen)} aria-label="Toggle chapter rail"
          >☰</button
        >
        <div class="crumb">
          <span class="crumb-book">{book.title}</span>
          <span class="crumb-ch">{book.chapters[ui.chapterIndex]?.title}</span>
        </div>
        <div class="tools">
          <button
            class="icon"
            onclick={() => (fontSize = Math.max(14, fontSize - 1))}
            aria-label="Smaller text">A−</button
          >
          <button
            class="icon"
            onclick={() => (fontSize = Math.min(24, fontSize + 1))}
            aria-label="Larger text">A+</button
          >
          <button
            class="icon"
            onclick={() => (theme = theme === 'light' ? 'dark' : 'light')}
            aria-label="Toggle theme">{theme === 'light' ? '☾' : '☀'}</button
          >
          <button class="icon" onclick={() => (settingsOpen = !settingsOpen)} aria-label="Settings"
            >⚙</button
          >
        </div>
      </header>

      <div
        class="pane"
        bind:this={pane}
        onscroll={onScroll}
        role="document"
        aria-label="Book content"
      >
        <div class="column" style="font-size: {fontSize}px">
          {#each book.chapters as chapter, i (chapter.id)}
            <section class="chapter-block">
              <h2 data-chapter={i}>{chapter.title}</h2>
              {@html chapter.content}
            </section>
          {/each}
          <p class="the-end">· · ·</p>
        </div>
      </div>

      {#if audio.chapterId}
        <div class="transport">
          <button class="icon" onclick={() => audio.toggle()} aria-label="Play or pause"
            >{audio.playing ? '❚❚' : '▶'}</button
          >
          <button class="icon" onclick={() => audio.skip(-15)} aria-label="Back 15 seconds"
            >−15</button
          >
          <button class="icon" onclick={() => audio.skip(15)} aria-label="Forward 15 seconds"
            >+15</button
          >
          <span class="t-title">{book.chapters.find((c) => c.id === audio.chapterId)?.title}</span>
          <div
            class="t-bar"
            role="presentation"
            onclick={(e) => audio.seek(e.offsetX / (e.currentTarget as HTMLElement).clientWidth)}
          >
            <div
              class="t-fill"
              style="width: {(audio.position / (audio.duration || 1)) * 100}%"
            ></div>
          </div>
          <span class="t-time">{fmt(audio.position)} / {fmt(audio.duration)}</span>
          <button class="icon" onclick={() => audio.stop()} aria-label="Close player">✕</button>
        </div>
      {/if}
    </main>

    {#if settingsOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="settings-scrim" onclick={() => (settingsOpen = false)}></div>
      <aside class="settings">
        <h3>Settings</h3>

        <h4>Text-to-speech</h4>
        <label class="field">
          Model
          <select
            bind:value={audio.prefs.model}
            onchange={() =>
              (audio.prefs.voice = voicesFor(audio.prefs.model, audio.prefs.language)[0])}
          >
            {#each MODELS as m (m)}
              <option value={m}>{m}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Voice
          <select bind:value={audio.prefs.voice}>
            {#each voicesFor(audio.prefs.model, audio.prefs.language) as v (v)}
              <option value={v}>{v}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          Quantization
          <select bind:value={audio.prefs.quantization}>
            <option value="f32">f32</option>
            <option value="f16">f16</option>
            <option value="q8">q8</option>
          </select>
        </label>
        <label class="field">
          Device
          <select bind:value={audio.prefs.device}>
            <option value="webgpu">webgpu</option>
            <option value="wasm">wasm</option>
          </select>
        </label>

        <h4>Playback</h4>
        <label class="field">
          Speed
          <select bind:value={audio.prefs.rate}>
            <option value={1}>1×</option>
            <option value={1.25}>1.25×</option>
            <option value={1.5}>1.5×</option>
            <option value={2}>2×</option>
          </select>
        </label>

        <h4>Export</h4>
        <label class="field">
          Format
          <select bind:value={audio.prefs.exportFormat}>
            {#each EXPORT_FORMATS as f (f)}
              <option value={f}>{f}</option>
            {/each}
          </select>
        </label>
        <button class="action" onclick={() => audio.export()}>
          {audio.exporting ? 'Exporting…' : `Export audiobook (${audio.prefs.exportFormat})`}
        </button>

        <h4>Reader</h4>
        <label class="field">
          Text size
          <input type="range" min="14" max="24" bind:value={fontSize} />
        </label>
      </aside>
    {/if}
  {:else}
    <p class="no-books">No books yet — press ＋ to import one.</p>
  {/if}
</div>

<style>
  .split {
    position: fixed;
    inset: 0;
    display: flex;
    background: var(--s-bg);
    color: var(--s-text);
  }

  .theme-light {
    --s-bg: #faf9f7;
    --s-text: #1c1917;
    --s-sub: #78716c;
    --s-panel: #fffffe;
    --s-line: #e7e5e4;
    --s-hover: #f5f5f4;
  }

  .theme-dark {
    --s-bg: #0c0a09;
    --s-text: #e7e5e4;
    --s-sub: #a8a29e;
    --s-panel: #1c1917;
    --s-line: #292524;
    --s-hover: #292524;
  }

  /* ---------- rail ---------- */
  .rail {
    width: 300px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--s-panel);
    border-right: 1px solid var(--s-line);
    transition: margin-left 0.2s ease;
  }

  .rail:not(.open) {
    margin-left: -300px;
  }

  .rail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 14px 8px;
  }

  .book-select {
    flex: 1;
    min-width: 0;
    background: none;
    border: 1px solid var(--s-line);
    color: var(--s-text);
    border-radius: 8px;
    padding: 9px 10px;
    font-size: 0.88rem;
    font-weight: 600;
    min-height: 40px;
  }

  .rail-close {
    display: none;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 14px 10px;
    border-bottom: 1px solid var(--s-line);
  }

  .search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: 1px solid var(--s-line);
    border-radius: 8px;
    color: var(--s-text);
    padding: 8px 10px;
    font-size: 0.82rem;
    min-height: 36px;
  }

  .hits {
    font-size: 0.72rem;
    color: var(--s-sub);
    white-space: nowrap;
  }

  .chapters {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .chapter {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    color: var(--s-text);
    text-align: left;
    padding: 10px 10px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.85rem;
    min-height: 40px;
  }

  .chapter:hover {
    background: var(--s-hover);
  }

  .chapter.current {
    background: var(--s-hover);
    font-weight: 700;
  }

  .tick {
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: var(--s-line);
    flex-shrink: 0;
  }

  .tick.read {
    background: var(--s-text);
  }

  .ch-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ch-hits {
    font-size: 0.7rem;
    color: var(--s-sub);
    background: var(--s-hover);
    border-radius: 999px;
    padding: 1px 7px;
  }

  .rail-foot {
    display: flex;
    justify-content: space-between;
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--s-line);
    color: var(--s-sub);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .rail-scrim {
    display: none;
  }

  /* ---------- pane ---------- */
  .pane-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--s-line);
    background: var(--s-panel);
  }

  .crumb {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .crumb-book {
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb-ch {
    font-size: 0.72rem;
    color: var(--s-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tools {
    display: flex;
    gap: 2px;
  }

  .icon {
    background: none;
    border: none;
    color: var(--s-sub);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 8px 10px;
    min-height: 36px;
    border-radius: 8px;
  }

  .icon:hover {
    background: var(--s-hover);
    color: var(--s-text);
  }

  .pane {
    flex: 1;
    overflow-y: auto;
  }

  .column {
    max-width: 42rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    line-height: 1.85;
  }

  .column :global(p) {
    margin: 0 0 1.1em;
  }

  .chapter-block h2 {
    font-size: 0.85em;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--s-sub);
    margin: 3.5rem 0 1.8rem;
    text-align: center;
  }

  .chapter-block:first-child h2 {
    margin-top: 0;
  }

  .the-end {
    text-align: center;
    color: var(--s-sub);
    letter-spacing: 0.5em;
    margin-top: 3rem;
  }

  /* ---------- generation / playback / settings ---------- */
  .chapter-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .chapter-row .chapter {
    flex: 1;
    min-width: 0;
  }

  .gen {
    width: 42px;
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--s-line);
    color: var(--s-sub);
    border-radius: 8px;
    font-size: 0.72rem;
    cursor: pointer;
    min-height: 34px;
    font-variant-numeric: tabular-nums;
  }

  .gen.ready {
    color: var(--s-text);
  }

  .gen:hover {
    background: var(--s-hover);
    color: var(--s-text);
  }

  .rail-actions {
    display: flex;
    gap: 6px;
    padding: 8px 14px 10px;
  }

  .action {
    flex: 1;
    background: none;
    border: 1px solid var(--s-line);
    color: var(--s-text);
    border-radius: 8px;
    padding: 9px 10px;
    font-size: 0.78rem;
    cursor: pointer;
    min-height: 38px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action:hover {
    background: var(--s-hover);
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-top: 1px solid var(--s-line);
    background: var(--s-panel);
  }

  .t-title {
    font-size: 0.72rem;
    color: var(--s-sub);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }

  .t-bar {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: var(--s-line);
    cursor: pointer;
  }

  .t-fill {
    height: 100%;
    background: var(--s-text);
    border-radius: 2px;
  }

  .t-time {
    font-size: 0.68rem;
    color: var(--s-sub);
    font-variant-numeric: tabular-nums;
  }

  .settings-scrim {
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(0, 0, 0, 0.3);
  }

  .settings {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(340px, 90vw);
    z-index: 50;
    background: var(--s-panel);
    border-left: 1px solid var(--s-line);
    overflow-y: auto;
    padding: 18px 18px 3rem;
  }

  .settings h3 {
    margin: 0 0 14px;
    font-size: 1rem;
  }

  .settings h4 {
    margin: 18px 0 8px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--s-sub);
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--s-sub);
    margin-bottom: 8px;
  }

  .field select,
  .field input {
    width: 160px;
    background: none;
    border: 1px solid var(--s-line);
    color: var(--s-text);
    border-radius: 8px;
    padding: 8px;
    font-size: 0.8rem;
    min-height: 36px;
  }

  .settings .action {
    width: 100%;
    margin-top: 4px;
  }

  .no-books {
    margin: auto;
    color: var(--s-sub);
  }

  /* ---------- mobile ---------- */
  @media (max-width: 860px) {
    .rail {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 30;
      margin-left: 0;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.25);
    }

    .rail:not(.open) {
      margin-left: -300px;
    }

    .rail-close {
      display: block;
    }

    .rail-scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 20;
      background: rgba(0, 0, 0, 0.3);
    }
  }
</style>
