<script lang="ts">
  // PROTOTYPE: activity / queue center — what is generating, done or failed
  // across every book, with retry where it matters.
  import type { Book } from '../lib/types/book'
  import { audio, type AudioStatus } from './audioSim.svelte'

  let { books, onClose }: { books: Book[]; onClose: () => void } = $props()

  let rows = $derived(
    books.flatMap((b) => b.chapters.map((c) => ({ b, c, e: audio.status(c.id) })))
  )

  let stats = $derived.by(() => {
    const s = { ready: 0, generating: 0, queued: 0, failed: 0, none: 0 }
    for (const r of rows) s[r.e.status === 'none' ? 'none' : r.e.status]++
    return s
  })

  let overallPct = $derived(rows.length ? (stats.ready / rows.length) * 100 : 0)

  function label(s: AudioStatus): string {
    return s === 'none' ? 'not generated' : s
  }

  function allMissing(): string[] {
    return rows.filter((r) => r.e.status === 'none' || r.e.status === 'failed').map((r) => r.c.id)
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation"></div>
<section class="overlay" role="dialog" aria-label="Generation activity">
  <header>
    <h2>Activity</h2>
    <div class="actions">
      <button class="btn" onclick={() => audio.retry(allMissing())}>Generate / retry all</button>
      <button class="icon" onclick={onClose} aria-label="Close">✕</button>
    </div>
  </header>

  <div class="summary">
    <div class="bar"><div class="fill" style="width: {overallPct}%"></div></div>
    <p>
      {stats.ready} ready · {stats.generating} generating · {stats.queued} queued ·
      {stats.failed} failed · {stats.none} not generated
    </p>
  </div>

  <div class="list">
    {#each books as b (b.title)}
      <h3>{b.title}</h3>
      <ul>
        {#each b.chapters as c (c.id)}
          <li>
            <span class="ch">{c.title}</span>
            {#if audio.status(c.id).status === 'generating'}
              <span class="bar mini">
                <span class="fill" style="width: {audio.status(c.id).progress * 100}%"></span>
              </span>
            {/if}
            <span class="pill s-{audio.status(c.id).status}">
              {label(audio.status(c.id).status)}{audio.status(c.id).status === 'generating'
                ? ` ${Math.round(audio.status(c.id).progress * 100)}%`
                : ''}
            </span>
            {#if audio.status(c.id).status === 'failed'}
              <button class="mini-btn" onclick={() => audio.retry([c.id])}>Retry</button>
            {:else if audio.status(c.id).status === 'ready'}
              <button class="mini-btn" onclick={() => audio.play(c.id)}>▶</button>
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
