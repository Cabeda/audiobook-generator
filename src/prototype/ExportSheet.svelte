<script lang="ts">
  // PROTOTYPE: export sheet — format and encoding options, size estimate and
  // progress. Encoding runs against the simulated pipeline.
  import type { Book } from '../lib/types/book'
  import { EXPORT_FORMATS } from '../lib/exportFormats'
  import { audio } from './audioSim.svelte'

  let { book, onClose }: { book: Book; onClose: () => void } = $props()

  let format = $state('m4b')
  let bitrate = $state(96)
  let markers = $state(true) // chapter markers
  let coverArt = $state(true)

  let duration = $derived(book.chapters.reduce((a, c) => a + audio.status(c.id).duration, 0))
  let readyN = $derived(book.chapters.filter((c) => audio.status(c.id).status === 'ready').length)
  let sizeMb = $derived(Math.round(((duration * bitrate) / 8 / 1024) * 10) / 10)

  function fmtTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  function start() {
    audio.prefs.exportFormat = format as typeof audio.prefs.exportFormat
    audio.export()
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
  <label class="field">
    Chapter markers
    <input type="checkbox" bind:checked={markers} />
  </label>
  <label class="field">
    Cover art
    <input type="checkbox" bind:checked={coverArt} />
  </label>

  <p class="estimate">Estimated size ≈ {sizeMb} MB</p>

  {#if audio.exporting}
    <div class="bar"><div class="fill" style="width: {audio.exportPct * 100}%"></div></div>
    <p class="estimate">Encoding… {Math.round(audio.exportPct * 100)}%</p>
  {:else if audio.exportDone}
    <p class="done">✓ Exported {book.title}.{format} ({sizeMb} MB)</p>
    <button class="go" onclick={onClose}>Done</button>
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

  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--border-color, #e7e5e4);
    overflow: hidden;
    margin-bottom: 8px;
  }

  .fill {
    height: 100%;
    background: var(--primary-color, #78716c);
    transition: width 0.2s ease;
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
