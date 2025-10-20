<script lang="ts">
  import UploadArea from './components/UploadArea.svelte'
  import BookInspector from './components/BookInspector.svelte'
  import GeneratePanel from './components/GeneratePanel.svelte'
  import type { EPubBook, Chapter } from './lib/epubParser'

  let book: EPubBook | null = null

  // Map of chapter id -> boolean (selected)
  let selectedMap: Map<string, boolean> = new Map()

  // generated audio map: chapter id -> { url, blob }
  let generated = new Map<string, { url: string; blob: Blob }>()

  async function onFileSelected(e: CustomEvent) {
    const file: File = e.detail.file
    const providedBook = e.detail.book
    if (providedBook) {
      book = providedBook
      // initialize selected map
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
      return
    }

    try {
      const { parseEpubFile } = await import('./lib/epubParser')
      book = await parseEpubFile(file)
      selectedMap = new Map(book.chapters.map((c) => [c.id, true]))
    } catch (err) {
      console.error('Failed to parse EPUB:', err)
      alert('Failed to parse EPUB. See console for details.')
    }
  }

  function onSelectionChanged(e: CustomEvent) {
    const entries: [string, boolean][] = e.detail.selected || []
    selectedMap = new Map(entries)
  }

  function onGenerated(e: CustomEvent) {
    const { id, blob } = e.detail
    const url = URL.createObjectURL(blob)
    generated.set(id, { url, blob })
    // trigger reactivity
    generated = new Map(generated)
  }

  function downloadBlob(id: string) {
    const rec = generated.get(id)
    if (!rec) return
    const a = document.createElement('a')
    a.href = rec.url
    a.download = `${id}.wav`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
</script>

<main>
  <h1>Audiobook Generator (Web)</h1>
  <UploadArea on:fileselected={onFileSelected} />

  {#if book}
    <BookInspector {book} on:selectionchanged={onSelectionChanged} />
    <GeneratePanel {book} {selectedMap} on:generated={onGenerated} />

    {#if generated.size > 0}
      <h3>Generated audio</h3>
      <div>
        {#each Array.from(generated.entries()) as [id, rec]}
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <audio controls src={rec.url}></audio>
            <div style="min-width:120px">{id}</div>
            <button on:click={() => downloadBlob(id)}>Download</button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</main>
