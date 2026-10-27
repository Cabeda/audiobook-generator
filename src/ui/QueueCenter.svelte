<script lang="ts">
  // Activity / queue center — what is generating, done or failed across every
  // book, with retry where it matters.
  import type { LibraryBook } from '../lib/libraryDB'
  import { getChapterVoiceSummary, type ChapterVoiceCount } from '../lib/libraryDB'
  import type { ChapterAudioView } from '../lib/reader/readerViewState'
  import { chapterAudioView } from '../lib/reader/readerViewState'
  import { minutesLeft } from '../lib/reader/readerViewState'
  import { chapterEstimateSeconds } from '../lib/reader/readerViewState'
  import { chapterErrors, chapterStatus, isGenerating } from '../stores/bookStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { staleVoiceCount } from '../lib/services/chapterPlan'
  import { reader } from './readerModel.svelte'

  let {
    books,
    onClose,
    onChapterSettings,
  }: {
    books: LibraryBook[]
    onClose: () => void
    onChapterSettings?: (book: LibraryBook) => void
  } = $props()

  /** One chapter's audio state, read live as generation progresses. */
  function status(id: string) {
    // The bridge reads the generation stores with get(); read them here so the
    // list tracks live progress.
    void [$segmentProgress, $chapterStatus, $chapterErrors]
    return reader.statusOf(id)
  }

  /** How each chapter's stored audio was made, keyed `${bookId}:${chapterId}`. */
  let voices = $state(new Map<string, ChapterVoiceCount[]>())

  async function loadVoices() {
    const entries = await Promise.all(
      books.map(async (b) => [b.id ?? 0, await getChapterVoiceSummary(b.id ?? 0)] as const)
    )
    const next = new Map<string, ChapterVoiceCount[]>()
    for (const [bookId, summary] of entries) {
      for (const [chapterId, counts] of summary) next.set(`${bookId}:${chapterId}`, counts)
    }
    voices = next
  }

  $effect(() => {
    void loadVoices()
  })

  /** The stored audio of a chapter, and whether any of it is another voice. */
  function voiceState(b: LibraryBook, c: LibraryBook['chapters'][number]) {
    const counts = voices.get(`${b.id ?? 0}:${c.id}`) ?? []
    const plan = reader.planFor(b, c)
    return { counts, plan, stale: staleVoiceCount(counts, plan) }
  }

  let staleChapters = $derived(
    books.flatMap((b) =>
      b.chapters
        .map((c) => ({ book: b, chapter: c, state: voiceState(b, c) }))
        .filter((row) => row.state.stale > 0)
        .map((row) => ({ ...row, key: `${row.book.id}:${row.chapter.id}` }))
    )
  )

  async function matchVoice(ids: string[]) {
    for (const book of books) {
      const chapters = book.chapters
        .filter((c) => ids.includes(`${book.id}:${c.id}`))
        .map((c) => c.id)
      if (chapters.length > 0) await reader.matchCurrentVoice(book, chapters)
    }
    await loadVoices()
  }

  let rows = $derived(books.flatMap((b) => b.chapters.map((c) => ({ b, c, e: status(c.id) }))))

  let stats = $derived.by(() => {
    const s = { ready: 0, generating: 0, failed: 0, none: 0 }
    for (const r of rows) s[r.e.state]++
    return s
  })

  let overallPct = $derived(rows.length ? (stats.ready / rows.length) * 100 : 0)

  /** Minutes of speech still to make in the book being read. */
  let left = $derived.by(() => {
    const book = books.find((b) => b.id === reader.bookId) ?? books[0]
    if (!book) return 0
    const seconds = book.chapters.reduce((s, c) => s + chapterEstimateSeconds(c.content), 0)
    return minutesLeft(seconds, reader.bookGeneration.percent)
  })

  let running = $derived($isGenerating || stats.generating > 0)

  function label(s: ChapterAudioView['state']): string {
    return s === 'none' ? 'not generated' : s
  }

  function allFailed(): string[] {
    return rows.filter((r) => r.e.state === 'failed').map((r) => r.c.id)
  }

  async function regenerateAll() {
    // shortcut: the bridge generates for the book open in the reader only;
    // per-book queueing belongs in the service when the queue outgrows that.
    await reader.generateMissing()
    await reader.retry(allFailed())
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="overlay" role="dialog" aria-label="Generation activity">
  <header>
    <h2>Activity</h2>
    <div class="actions">
      {#if running}
        <button class="btn ghost" onclick={() => reader.cancelGeneration()}>Stop</button>
      {/if}
      {#if staleChapters.length > 0}
        <button
          class="btn"
          disabled={running}
          onclick={() => void matchVoice(staleChapters.map((row) => row.key))}
        >
          Match current voice ({staleChapters.length})
        </button>
      {/if}
      <button class="btn" onclick={regenerateAll}>Generate / retry all</button>
      <button class="icon" onclick={onClose} aria-label="Close">✕</button>
    </div>
  </header>

  <div class="summary">
    <div class="bar"><div class="fill" style="width: {overallPct}%"></div></div>
    <p>
      {stats.ready} ready · {stats.generating} generating · {stats.failed} failed ·
      {stats.none} not generated
      {#if running && left > 0}· ~{left} min of speech left{/if}
    </p>
  </div>

  <div class="list">
    {#each books as b, i (b.id ?? i)}
      <h3>{b.title}</h3>
      <ul>
        {#each b.chapters as c (c.id)}
          <li>
            <span class="ch">
              {c.title}
              {#if voiceState(b, c).counts.length > 0}
                <span class="voices">
                  {voiceState(b, c)
                    .counts.map((entry) => `${entry.model}/${entry.voice} ×${entry.count}`)
                    .join(' · ')}
                </span>
              {/if}
            </span>
            {#if status(c.id).state === 'generating'}
              <span class="bar mini">
                <span class="fill" style="width: {status(c.id).progress * 100}%"></span>
              </span>
            {/if}
            <span class="pill s-{status(c.id).state}">
              {label(status(c.id).state)}{status(c.id).state === 'generating'
                ? ` ${Math.round(status(c.id).progress * 100)}%`
                : ''}
            </span>
            {#if voiceState(b, c).stale > 0}
              <button
                class="mini-btn"
                disabled={running}
                onclick={() => void matchVoice([`${b.id}:${c.id}`])}
              >
                Match voice ({voiceState(b, c).stale})
              </button>
            {/if}
            {#if onChapterSettings}
              <button class="mini-btn" onclick={() => onChapterSettings?.(b)}>Voice…</button>
            {/if}
            {#if status(c.id).state === 'failed'}
              <button class="mini-btn" onclick={() => reader.retry([c.id])}>Retry</button>
            {:else if status(c.id).state === 'ready'}
              <button class="mini-btn" onclick={() => reader.play(c)}>▶</button>
            {/if}
          </li>
        {/each}
      </ul>
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
    max-width: 680px;
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
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
    flex-wrap: wrap;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .summary {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-color, #e7e5e4);
  }

  .summary p {
    margin: 8px 0 0;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--border-color, #e7e5e4);
    overflow: hidden;
  }

  .bar.mini {
    width: 70px;
    display: inline-block;
    vertical-align: middle;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--success-color, #6b8f71);
    transition: width 0.2s ease;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px 2rem;
  }

  h3 {
    margin: 16px 0 6px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--secondary-text, #78716c);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
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

  /* what the stored audio was made with, under the chapter title */
  .voices {
    display: block;
    font-size: 0.72rem;
    color: var(--secondary-text, #78716c);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-btn:disabled,
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .pill {
    font-size: 0.7rem;
    border-radius: 999px;
    padding: 2px 9px;
    background: var(--selected-bg, #f5f5f4);
    color: var(--secondary-text, #78716c);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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
  }

  .mini-btn {
    background: none;
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 0.72rem;
    cursor: pointer;
    min-height: 28px;
    white-space: nowrap;
  }

  .mini-btn:hover {
    background: var(--selected-bg, #f5f5f4);
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
  }

  .icon:hover {
    background: var(--selected-bg, #f5f5f4);
    color: var(--text-color, #1c1917);
  }

  @media (max-width: 640px) {
    .overlay {
      inset: 8px;
    }

    .bar.mini {
      display: none;
    }
  }
</style>
