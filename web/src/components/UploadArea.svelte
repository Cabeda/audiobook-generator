<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
  let file: File | null = null
  let parsing = false

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

<style>
  .drop { border: 2px dashed #bbb; padding: 20px; border-radius: 8px; }
</style>

<div class="drop" role="button" tabindex="0" on:drop|preventDefault={onDrop} on:dragover|preventDefault>
  <p>
    {#if parsing}
      Parsing EPUB...
    {:else}
      Drop EPUB file here or <label><input type="file" accept=".epub" on:change={onFileChange} style="display:none">select a file</label>
    {/if}
  </p>
  {#if file}
    <p>Selected: {file.name}</p>
  {/if}
</div>