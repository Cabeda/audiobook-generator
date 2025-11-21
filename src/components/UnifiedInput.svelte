<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Readability } from '@mozilla/readability'
  import type { Book } from '../lib/types/book'

  const dispatch = createEventDispatcher()

  // File state
  let fileInput: HTMLInputElement
  let parsing = false
  let dragActive = false

  // URL state
  let url = ''
  let urlLoading = false
  let error: string | null = null

  // --- File Handling ---

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const f = input.files?.[0] || null
    handleFile(f)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragActive = false
    const f = e.dataTransfer?.files?.[0] || null
    handleFile(f)
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragActive = true
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    dragActive = false
  }

  function onContainerClick(e: MouseEvent) {
    // Don't trigger file input if clicking on the URL input or button
    if ((e.target as HTMLElement).closest('.url-input-group')) {
      return
    }
    fileInput?.click()
  }

  async function handleFile(f: File | null) {
    if (!f) return
    parsing = true
    error = null
    try {
      const { loadBook } = await import('../lib/bookLoader')
      const book = await loadBook(f)
      dispatch('bookloaded', { book })
    } catch (err) {
      console.error('Failed to parse book:', err)
      error = err instanceof Error ? err.message : 'Unknown error parsing file'
    } finally {
      parsing = false
    }
  }

  // --- URL Handling ---

  async function fetchArticle() {
    if (!url) return

    urlLoading = true
    error = null

    try {
      // Use allorigins.win as a CORS proxy
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
      const response = await fetch(proxyUrl)

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`)
      }

      const data = await response.json()
      const html = data.contents

      if (!html) {
        throw new Error('No content received from URL')
      }

      // Parse HTML
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')

      // Use Readability to extract article content
      const reader = new Readability(doc)
      const article = reader.parse()

      if (!article) {
        throw new Error('Failed to parse article content')
      }

      // Create Book object
      const book: Book = {
        title: article.title || 'Untitled Article',
        author: article.byline || article.siteName || 'Unknown Author',
        cover: undefined,
        format: 'html',
        chapters: [
          {
            id: 'article-content',
            title: article.title || 'Article Content',
            content: article.textContent || '',
          },
        ],
      }

      dispatch('bookloaded', { book })
      url = '' // Clear input on success
    } catch (err) {
      console.error('Error fetching article:', err)
      error = err instanceof Error ? err.message : 'Failed to fetch article'
    } finally {
      urlLoading = false
    }
  }

  function handleUrlKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.stopPropagation()
      if (!urlLoading && url) {
        fetchArticle()
      }
    }
  }
</script>

<input
  type="file"
  accept=".epub,.pdf,.txt,.html,.htm,.mobi,.docx,application/epub+zip,application/pdf,text/plain,text/html"
  on:change={onFileChange}
  bind:this={fileInput}
  style="display:none"
/>

<div
  class="unified-input"
  class:drag-active={dragActive}
  role="button"
  tabindex="0"
  on:click={onContainerClick}
  on:keydown={(e) => e.key === 'Enter' && fileInput?.click()}
  on:drop={onDrop}
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
  aria-label="Upload eBook or import from URL"
>
  <div class="content">
    <div class="icon">📚</div>
    <p class="primary">Drop eBook file here or click to select</p>
    <p class="secondary">Supported: EPUB, PDF, TXT, HTML</p>

    <div class="divider">
      <span>OR</span>
    </div>

    <div class="url-input-group" on:click|stopPropagation>
      <input
        type="url"
        placeholder="Paste article URL here..."
        bind:value={url}
        on:keydown={handleUrlKeydown}
        disabled={urlLoading || parsing}
      />
      <button on:click={fetchArticle} disabled={!url || urlLoading || parsing}>
        {#if urlLoading}
          ⏳
        {:else}
          Import
        {/if}
      </button>
    </div>

    {#if parsing}
      <p class="status">Parsing eBook...</p>
    {/if}

    {#if error}
      <p class="error">⚠️ {error}</p>
    {/if}
  </div>
</div>

<style>
  .unified-input {
    border: 2px dashed #ccc;
    border-radius: 12px;
    padding: 40px 20px;
    text-align: center;
    background: #f9f9f9;
    transition: all 0.2s ease;
    cursor: pointer;
    position: relative;
  }

  .unified-input:hover,
  .unified-input.drag-active {
    border-color: #2196f3;
    background: #f0f7ff;
  }

  .content {
    max-width: 500px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .icon {
    font-size: 48px;
    margin-bottom: 8px;
  }

  .primary {
    font-size: 1.2em;
    font-weight: 500;
    color: #333;
    margin: 0;
  }

  .secondary {
    font-size: 0.9em;
    color: #666;
    margin: 0;
  }

  .divider {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 16px 0;
    color: #999;
    font-size: 0.9em;
    font-weight: 500;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #ddd;
  }

  .divider span {
    padding: 0 10px;
  }

  .url-input-group {
    display: flex;
    width: 100%;
    gap: 8px;
  }

  .url-input-group input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 16px;
  }

  .url-input-group button {
    padding: 10px 20px;
    background: #2196f3;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .url-input-group button:hover:not(:disabled) {
    background: #1976d2;
  }

  .url-input-group button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .status {
    color: #2196f3;
    font-weight: 500;
  }

  .error {
    color: #d32f2f;
    margin-top: 10px;
  }
</style>
