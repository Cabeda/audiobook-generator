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
    // Try to parse inline for quick feedback if parser is present
    try {
      const mod = await import('../lib/epubParser')
      const book = await mod.parseEpubFile(f)
      dispatch('fileselected', { file: f, book })
    } catch (err) {
      // Fallback: just emit file and let parent import parser
      dispatch('fileselected', { file: f })
    } finally {
      parsing = false
    }
  }
</script>

<input
  type="file"
  accept=".epub"
  on:change={onFileChange}
  bind:this={fileInput}
  style="display:none"
  aria-label="Upload EPUB file"
/>

<div
  class="drop"
  role="button"
  tabindex="0"
  on:click={onClick}
  on:keypress={onKeyPress}
  on:drop|preventDefault={onDrop}
  on:dragover|preventDefault
  aria-label="Click to upload or drop EPUB file"
>
  <p>
    {#if parsing}
      Parsing EPUB...
    {:else}
      📚 Drop EPUB file here or click to select
    {/if}
  </p>
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
</style>
