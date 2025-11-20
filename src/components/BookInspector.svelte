<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { Book, Chapter } from '../lib/types/book'

  export let book: Book
  const dispatch = createEventDispatcher()

  // Map of chapter id -> selected
  let selected = new Map<string, boolean>()

  // initialize selections when book changes
  $: if (book) {
    const newMap = new Map<string, boolean>()
    for (const ch of book.chapters) {
      // default: selected
      newMap.set(ch.id, selected.get(ch.id) ?? true)
    }
    selected = newMap
  }

  function toggleChapter(id: string) {
    selected.set(id, !selected.get(id))
    // trigger reactivity
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function selectAll() {
    for (const k of selected.keys()) selected.set(k, true)
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function deselectAll() {
    for (const k of selected.keys()) selected.set(k, false)
    selected = new Map(selected)
    dispatch('selectionchanged', { selected: Array.from(selected.entries()) })
  }

  function exportSelected() {
    const selectedChapters: Chapter[] = book.chapters.filter((ch) => selected.get(ch.id))
    if (selectedChapters.length === 0) {
      alert('No chapters selected')
      return
    }
    const contents = selectedChapters
      .map((c, i) => `=== ${c.title} ===\n\n${c.content}\n\n`)
      .join('\n')
    const blob = new Blob([contents], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeTitle = (book.title || 'book').replace(/[^a-z0-9]/gi, '_').toLowerCase()
    a.download = `${safeTitle}_selected.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    dispatch('export', { count: selectedChapters.length })
  }

  function copyChapterContent(ch: Chapter) {
    navigator.clipboard
      ?.writeText(ch.content)
      .then(() => alert('Copied to clipboard'))
      .catch(() => alert('Clipboard not available'))
  }
</script>

<div>
  <div class="book-meta">
    <h2>{book.title}</h2>
    {#if book.format}
      <span class="format-badge">{book.format.toUpperCase()}</span>
    {/if}
  </div>
  <p><strong>Author:</strong> {book.author}</p>
  {#if book.cover}
    <img class="cover" src={book.cover} alt="cover" />
  {/if}

  <div class="controls">
    <button on:click={selectAll}>Select all</button>
    <button on:click={deselectAll}>Deselect all</button>
    <button on:click={exportSelected}>Export selected</button>
    <div style="margin-left:auto">
      Selected: {Array.from(selected.values()).filter(Boolean).length} / {book.chapters.length}
    </div>
  </div>

  <h3>Chapters</h3>
  <div>
    {#each book.chapters as ch}
      <div class="chapter">
        <div style="width:28px">
          <input
            type="checkbox"
            checked={selected.get(ch.id)}
            on:change={() => toggleChapter(ch.id)}
          />
        </div>
        <div style="flex:1">
          <div class="chapter-title">{ch.title}</div>
          <div style="font-size:0.9em;color:#444">
            {ch.content.slice(0, 300)}{ch.content.length > 300 ? '…' : ''}
          </div>
        </div>
        <div style="width:90px; text-align:right">
          <button on:click={() => copyChapterContent(ch)}>Copy</button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .cover {
    max-width: 200px;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }
  .chapter {
    padding: 8px;
    border-bottom: 1px solid #eee;
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .chapter-title {
    font-weight: 600;
  }
  .controls {
    margin: 12px 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .book-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .book-meta h2 {
    margin: 0;
  }
  .format-badge {
    display: inline-block;
    padding: 4px 10px;
    background: #e3f2fd;
    color: #1976d2;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }
</style>
