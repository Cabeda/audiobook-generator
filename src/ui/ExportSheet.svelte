<script lang="ts">
  // Export sheet — format and encoding options, size estimate and progress.
  // Encoding runs through the real export service via the reader bridge.
  import type { Book } from '../lib/types/book'
  import { EXPORT_FORMATS, type ExportFormat } from '../lib/exportFormats'
  import { chapterErrors, chapterStatus } from '../stores/bookStore'
  import { segmentProgress } from '../stores/segmentProgressStore'
  import { reader } from './readerModel.svelte'

  let { book, onClose }: { book: Book; onClose: () => void } = $props()

  let format = $state('m4b')
  let bitrate = $state(96)
  let markers = $state(true) // chapter markers (injected automatically in m4b)
  let coverArt = $state(true)

  /** One chapter's audio state, read live as generation progresses. */
  function status(id: string) {
    // The bridge reads the generation stores with get(); read them here so the
    // counts track live progress.
    void [$segmentProgress, $chapterStatus, $chapterErrors]
    return reader.statusOf(id)
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
  let sizeMb = $derived(Math.round(((duration * bitrate) / 8 / 1024) * 10) / 10)

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  function start() {
    reader.prefs.exportFormat = format as ExportFormat
    void reader.export()
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<div class="panel" role="dialog" aria-label="Export audiobook">
  <header>
    <h2>Export audiobook</h2>
    <button class="icon" onclick={onClose} aria-label="Close">✕</button>
  </header>

  <p class="book-line">
    {book.title} · {fmtTime(duration)} · {readyN}/{book.chapters.length} chapters with audio
  </p>

  {#if readyN < book.chapters.length}
    <p class="warn">
      Only generated chapters will be included ({readyN} of {book.chapters.length}).
    </p>
  {/if}

  <label class="field">
    Format
    <select bind:value={format}>
      {#each EXPORT_FORMATS as f (f.value)}
        <option value={f.value}>{f.label}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    Bitrate
    <select bind:value={bitrate}>
      <option value={64}>64 kbps</option>
      <option value={96}>96 kbps</option>
      <option value={128}>128 kbps</option>
      <option value={192}>192 kbps</option>
    </select>
  </label>
  {#if format === 'm4b'}
    <label class="field">
      Chapter markers (included in M4B)
      <input type="checkbox" bind:checked={markers} disabled />
    </label>
  {/if}
  <label class="field">
    Cover art (EPUB only)
    <input type="checkbox" bind:checked={coverArt} disabled={format !== 'epub'} />
  </label>

  <p class="estimate">Estimated size ≈ {sizeMb} MB</p>

  {#if reader.exportState.busy}
    <p class="estimate">Exporting…</p>
  {:else if reader.exportState.done}
    <p class="done">✓ Exported {book.title}.{format} ({sizeMb} MB)</p>
    <button class="go" onclick={onClose}>Done</button>
  {:else if reader.exportState.error}
    <p class="warn">{reader.exportState.error}</p>
    <button class="go" onclick={start}>Retry</button>
  {:else}
    <button class="go" onclick={start}>Export</button>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 60;
  }

  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(420px, calc(100vw - 32px));
    background: var(--surface-color, #fff);
    color: var(--text-color, #1c1917);
    border: 1px solid var(--border-color, #e7e5e4);
    border-radius: 16px;
    padding: 18px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .book-line {
    margin: 0 0 12px;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
  }

  .warn {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--warning-bg, #faf5ed);
    color: var(--warning-color, #b59f6b);
    font-size: 0.78rem;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.88rem;
    margin-bottom: 10px;
    min-height: 38px;
  }

  .field select {
    width: 180px;
    background: var(--input-bg, #fff);
    border: 1px solid var(--border-color, #e7e5e4);
    color: inherit;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 0.82rem;
    min-height: 36px;
  }

  .field input[type='checkbox'] {
    width: 18px;
    height: 18px;
  }

  .estimate {
    margin: 4px 0 12px;
    font-size: 0.82rem;
    color: var(--secondary-text, #78716c);
    font-variant-numeric: tabular-nums;
  }

  .done {
    margin: 0 0 12px;
    font-size: 0.88rem;
    color: var(--success-color, #6b8f71);
    font-weight: 600;
  }

  .go {
    width: 100%;
    background: var(--text-color, #1c1917);
    color: var(--bg-color, #faf9f7);
    border: none;
    border-radius: 10px;
    padding: 11px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    min-height: 42px;
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
    background: var(--hover-bg, rgba(120, 113, 108, 0.12));
  }

  @media (max-width: 640px) {
    .panel {
      width: calc(100vw - 16px);
    }

    .field select {
      width: 150px;
    }
  }
</style>
