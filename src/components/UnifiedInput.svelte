<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Readability } from '@mozilla/readability'
  import type { Book } from '../lib/types/book'
  import { retryWithBackoff } from '../lib/retryUtils'

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
      dispatch('bookloaded', { book, sourceFile: f })
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
      // Use retry with exponential backoff for better resilience
      const data = await retryWithBackoff(
        async () => {
          // Use allorigins.win as a CORS proxy
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
          const response = await fetch(proxyUrl)

          // Store status for shouldRetry check

          if (!response.ok) {
            const error: Error & { status?: number } = new Error(
              `Failed to fetch: ${response.statusText}`
            )
            error.status = response.status
            throw error
          }

          const data = await response.json()

          if (!data.contents) {
            const error: Error & { status?: number } = new Error('No content received from URL')
            error.status = 200
            throw error
          }

          return data
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
          shouldRetry: (error: Error & { status?: number }) => {
            // Retry on network errors (no status) or server errors (5xx)
            // Don't retry on client errors (4xx) as they won't succeed
            if (!error.status) {
              // Network error (CORS, timeout, etc.) - should retry
              return true
            }
            // Retry on server errors (5xx) including 522 (Connection timed out)
            // Don't retry on client errors (4xx)
            return error.status >= 500
          },
        }
      )

      const html = data.contents

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

      dispatch('bookloaded', { book, sourceUrl: url })
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
  onchange={onFileChange}
  bind:this={fileInput}
  style="display:none"
/>

<div
  class="unified-input"
  class:drag-active={dragActive}
  role="button"
  tabindex="0"
  onclick={onContainerClick}
  onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  aria-label="Upload eBook or import from URL"
>
  <div class="content">
    <div class="icon">📚</div>
    <p class="primary">Drop eBook file here or click to select</p>
    <p class="secondary">Supported: EPUB, PDF, TXT, HTML (DRM-free only)</p>

    <div class="divider">
      <span>OR</span>
    </div>

    <div class="url-input-group">
      <label for="article-url" class="sr-only">Article URL</label>
      <input
        id="article-url"
        type="url"
        placeholder="Paste article URL here..."
        bind:value={url}
        onkeydown={handleUrlKeydown}
        disabled={urlLoading || parsing}
      />
      <button
        onclick={fetchArticle}
        disabled={!url || urlLoading || parsing}
        aria-label="Import article from URL"
      >
        {#if urlLoading}
          <span aria-hidden="true">⏳</span>
          <span class="sr-only">Loading...</span>
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
    border: 2px dashed var(--input-border);
    border-radius: 12px;
    padding: 40px 20px;
    text-align: center;
    background: var(--input-bg);
    transition: all 0.2s ease;
    cursor: pointer;
    position: relative;
  }

  .unified-input:hover,
  .unified-input.drag-active {
    border-color: var(--primary-color);
    background: var(--selected-bg);
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
    color: var(--text-color);
    margin: 0;
  }

  .secondary {
    font-size: 0.9em;
    color: var(--secondary-text);
    margin: 0;
  }

  .divider {
    display: flex;
    align-items: center;
    width: 100%;
    margin: 16px 0;
    color: var(--secondary-text);
    font-size: 0.9em;
    font-weight: 500;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--border-color);
  }

  .divider span {
    padding: 0 10px;
  }

  .url-input-group {
    display: flex;
    width: 100%;
    gap: 8px;
  }

  @media (max-width: 480px) {
    .url-input-group {
      flex-direction: column;
    }

    .url-input-group button {
      width: 100%;
    }
  }

  .url-input-group input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    font-size: 16px;
    background: var(--bg-color);
    color: var(--text-color);
  }

  .url-input-group button {
    padding: 10px 20px;
    background: var(--primary-color);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .url-input-group button:hover:not(:disabled) {
    background: var(--primary-hover);
  }

  .url-input-group button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .status {
    color: var(--primary-color);
    font-weight: 500;
  }

  .error {
    color: #d32f2f;
    margin-top: 10px;
  }
</style>
