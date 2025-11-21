<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { Readability } from '@mozilla/readability'
  import type { Book } from '../lib/types/book'

  const dispatch = createEventDispatcher()

  let url = ''
  let loading = false
  let error: string | null = null

  async function fetchArticle() {
    if (!url) return

    loading = true
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
        cover: undefined, // Readability doesn't reliably give a cover image URL we can use directly without more proxying
        format: 'html', // Treat as HTML/Text
        chapters: [
          {
            id: 'article-content',
            title: article.title || 'Article Content',
            content: article.textContent || '', // Use textContent for TTS
          },
        ],
      }

      dispatch('bookloaded', { book })
      url = '' // Clear input on success
    } catch (err) {
      console.error('Error fetching article:', err)
      error = err instanceof Error ? err.message : 'Failed to fetch article'
    } finally {
      loading = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !loading && url) {
      fetchArticle()
    }
  }
</script>

<div class="url-input-container">
  <h3>Import from URL</h3>
  <div class="input-group">
    <input
      type="url"
      placeholder="Paste article URL here..."
      bind:value={url}
      on:keydown={handleKeydown}
      disabled={loading}
    />
    <button on:click={fetchArticle} disabled={!url || loading}>
      {#if loading}
        ⏳ Fetching...
      {:else}
        Fetch Article
      {/if}
    </button>
  </div>

  {#if error}
    <div class="error-message">
      ⚠️ {error}
    </div>
  {/if}

  <p class="hint">
    Note: Uses a public proxy to bypass CORS. Works best with public articles (news, blogs, wikis).
  </p>
</div>

<style>
  .url-input-container {
    padding: 20px;
    border: 2px dashed #ccc;
    border-radius: 8px;
    background: #f9f9f9;
    margin-bottom: 20px;
    text-align: center;
  }

  h3 {
    margin-top: 0;
    margin-bottom: 15px;
    color: #555;
  }

  .input-group {
    display: flex;
    gap: 10px;
    max-width: 600px;
    margin: 0 auto;
  }

  input {
    flex: 1;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 16px;
  }

  button {
    padding: 10px 20px;
    background: #2196f3;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }

  button:hover:not(:disabled) {
    background: #1976d2;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .error-message {
    color: #d32f2f;
    margin-top: 10px;
    font-size: 14px;
  }

  .hint {
    margin-top: 10px;
    font-size: 12px;
    color: #888;
  }
</style>
