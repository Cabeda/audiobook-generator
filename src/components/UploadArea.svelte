<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
  let file: File | null = null
  let parsing = false
  let fileInput: HTMLInputElement

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const f = input.files?.[0] || null
    handleFile(f)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0] || null
    handleFile(f)
  }

  function onClick() {
    fileInput?.click()
  }

  function onKeyPress(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInput?.click()
    }
  }

  async function handleFile(f: File | null) {
    if (!f) return
    file = f
    parsing = true
    try {
      // Use new book loader instead of direct EPUB parser
      const { loadBook } = await import('../lib/bookLoader')
      const book = await loadBook(f)
      dispatch('fileselected', { file: f, book })
    } catch (err) {
      console.error('Failed to parse book:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      alert(`Failed to parse book: ${message}`)
    } finally {
      parsing = false
    }
  }
</script>

<input
  type="file"
  accept=".epub,.pdf,.txt,.html,.htm,.mobi,.docx,application/epub+zip,application/pdf,text/plain,text/html"
  on:change={onFileChange}
  bind:this={fileInput}
  style="display:none"
  aria-label="Upload eBook file"
/>

<div
  class="drop"
  role="button"
  tabindex="0"
  on:click={onClick}
  on:keypress={onKeyPress}
  on:drop={(e) => {
    e.preventDefault()
    onDrop(e)
  }}
  on:dragover={(e) => e.preventDefault()}
  aria-label="Click to upload or drop EPUB file"
>
  {#if parsing}
    <p>Parsing eBook...</p>
  {:else}
    <div class="upload-text">
      <p class="primary">📚 Drop eBook file here or click to select</p>
      <p class="secondary supported-formats">Supported: EPUB, PDF, TXT, HTML (MOBI coming soon)</p>
    </div>
  {/if}
  {#if file}
    <p style="color: #4CAF50; font-weight: 500;">Selected: {file.name}</p>
  {/if}
</div>

<style>
  .drop {
    border: 2px dashed #bbb;
    padding: 40px 20px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }
  .drop:hover {
    border-color: #4caf50;
    background-color: #f8f8f8;
  }
  .drop:active {
    background-color: #e8e8e8;
  }
  .drop p {
    margin: 8px 0;
  }
  .supported-formats {
    font-size: 0.85em;
    color: #666;
  }
</style>
