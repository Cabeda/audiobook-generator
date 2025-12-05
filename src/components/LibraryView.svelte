<script lang="ts">
  import { onMount } from 'svelte'
  import BookCard from './BookCard.svelte'
  import {
    libraryBooks,
    libraryLoading,
    libraryError,
    refreshLibrary,
    removeBookFromLibrary,
  } from '../stores/libraryStore'
  import type { BookMetadata } from '../lib/libraryDB'
  import { getStorageUsage } from '../lib/libraryDB'

  interface Props {
    onbookselected: (bookId: number) => void
  }

  let { onbookselected }: Props = $props()

  let searchQuery = $state('')
  let debouncedSearchQuery = $state('')
  let sortBy = $state<'recent' | 'title' | 'author'>('recent')
  let storageInfo = $state<{ usage: number; quota: number; percentage: number } | null>(null)

  let viewMode = $state<'grid' | 'list'>('grid')

  // Debounce search to avoid filtering on every keystroke
  $effect(() => {
    const timeout = setTimeout(() => {
      debouncedSearchQuery = searchQuery
    }, 300)

    return () => clearTimeout(timeout)
  })

  // Initialize view mode from local storage
  onMount(async () => {
    const savedView = localStorage.getItem('library_view_mode')
    if (savedView === 'list' || savedView === 'grid') {
      viewMode = savedView
    }
    await refreshLibrary()
    await updateStorageInfo()
  })

  // Persist view mode
  $effect(() => {
    localStorage.setItem('library_view_mode', viewMode)
  })

  // Computed filtered and sorted books
  let filteredBooks = $derived.by(() => {
    let books = $libraryBooks

    // Filter by debounced search query
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase()
      books = books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query)
      )
    }

    // Sort books
    const sorted = [...books]
    if (sortBy === 'recent') {
      sorted.sort((a, b) => b.lastAccessed - a.lastAccessed)
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy === 'author') {
      sorted.sort((a, b) => a.author.localeCompare(b.author))
    }

    return sorted
  })

  async function updateStorageInfo() {
    try {
      storageInfo = await getStorageUsage()
    } catch (err) {
      console.error('Failed to get storage info:', err)
    }
  }

  function handleBookLoad(book: BookMetadata) {
    onbookselected(book.id)
  }

  async function handleBookDelete(book: BookMetadata) {
    await removeBookFromLibrary(book.id)
    await updateStorageInfo()
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }
</script>

<div class="library-view">
  <div class="library-header">
    <div class="header-top">
      <h2>My Library</h2>
      {#if storageInfo && storageInfo.quota > 0}
        <div class="storage-info">
          <span class="storage-text"
            >{formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}</span
          >
          <div class="storage-bar">
            <div class="storage-fill" style="width: {Math.min(storageInfo.percentage, 100)}%"></div>
          </div>
        </div>
      {/if}
    </div>

    <div class="controls">
      <input
        type="text"
        class="search-input"
        placeholder="Search by title or author..."
        bind:value={searchQuery}
      />

      <div class="view-controls">
        <select class="sort-select" bind:value={sortBy}>
          <option value="recent">Recently Accessed</option>
          <option value="title">Title A-Z</option>
          <option value="author">Author A-Z</option>
        </select>

        <div class="view-toggle">
          <button
            class="toggle-btn"
            class:active={viewMode === 'grid'}
            onclick={() => (viewMode = 'grid')}
            aria-label="Grid view"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
          </button>
          <button
            class="toggle-btn"
            class:active={viewMode === 'list'}
            onclick={() => (viewMode = 'list')}
            aria-label="List view"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="library-content">
    {#if $libraryLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading library...</p>
      </div>
    {:else if $libraryError}
      <div class="error-state">
        <p class="error-icon">⚠️</p>
        <p class="error-message">{$libraryError}</p>
        <button onclick={() => refreshLibrary()}>Try Again</button>
      </div>
    {:else if filteredBooks.length === 0}
      <div class="empty-state">
        {#if searchQuery}
          <p class="empty-icon">🔍</p>
          <h3>No books found</h3>
          <p>Try a different search term</p>
        {:else}
          <p class="empty-icon">📚</p>
          <h3>Your library is empty</h3>
          <p>Upload a book or article to get started!</p>
        {/if}
      </div>
    {:else}
      <div class="books-grid" class:list-view={viewMode === 'list'}>
        {#each filteredBooks as book (book.id)}
          <BookCard {book} {viewMode} onload={handleBookLoad} ondelete={handleBookDelete} />
        {/each}
      </div>
      <div class="library-stats">
        <p>
          Showing {filteredBooks.length} of {$libraryBooks.length}
          {$libraryBooks.length === 1 ? 'book' : 'books'}
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .library-view {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }

  .library-header {
    margin-bottom: 32px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  h2 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    color: #1f2937;
  }

  .storage-info {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .storage-text {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .storage-bar {
    width: 120px;
    height: 6px;
    background: #e5e7eb;
    border-radius: 3px;
    overflow: hidden;
  }

  .storage-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);
    transition: width 0.3s ease;
  }

  .controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
  }

  .view-controls {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .search-input {
    flex: 1;
    min-width: 200px;
    padding: 10px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 0.95rem;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    outline: none;
    border-color: #3b82f6;
    border-width: 2px;
    padding: 9px 15px; /* Adjust padding to prevent shift */
  }

  .sort-select {
    padding: 10px 12px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    font-size: 0.95rem;
    background: white;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .sort-select:focus {
    outline: none;
    border-color: #3b82f6;
    border-width: 2px;
    padding: 9px 11px;
  }

  .view-toggle {
    display: flex;
    background: #f3f4f6;
    border-radius: 8px;
    padding: 2px;
    border: 1px solid #e5e7eb;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    color: #6b7280;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .toggle-btn:hover {
    color: #374151;
  }

  .toggle-btn.active {
    background: white;
    color: #3b82f6;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .library-content {
    min-height: 400px;
  }

  .books-grid {
    display: grid;
    /* Optimized for smaller items: ~180px min width */
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
    transition: all 0.3s ease;
  }

  /* List View Overrides */
  .books-grid.list-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .library-stats {
    text-align: center;
    padding: 16px;
    color: #6b7280;
    font-size: 0.875rem;
  }

  .loading-state,
  .error-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 24px;
    text-align: center;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid #e5e7eb;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-state p {
    color: #6b7280;
    margin: 0;
  }

  .error-state {
    color: #dc2626;
  }

  .error-icon {
    font-size: 3rem;
    margin: 0 0 16px 0;
  }

  .error-message {
    margin: 0 0 16px 0;
    font-size: 1rem;
  }

  .error-state button {
    padding: 10px 24px;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .error-state button:hover {
    background: #b91c1c;
  }

  .empty-icon {
    font-size: 4rem;
    margin: 0 0 16px 0;
  }

  .empty-state h3 {
    margin: 0 0 8px 0;
    font-size: 1.5rem;
    color: #1f2937;
  }

  .empty-state p {
    margin: 0;
    color: #6b7280;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .library-view {
      padding: 16px;
    }

    h2 {
      font-size: 1.5rem;
    }

    .header-top {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .controls {
      flex-direction: column;
    }

    .search-input {
      min-width: 100%;
    }

    .books-grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 16px;
    }
  }

  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    h2 {
      color: #f9fafb;
    }

    .search-input,
    .sort-select,
    .view-toggle {
      background: #1f2937;
      color: #f9fafb;
      border-color: #374151;
    }

    .toggle-btn {
      color: #9ca3af;
    }

    .toggle-btn:hover {
      color: #e5e7eb;
    }

    .toggle-btn.active {
      background: #374151;
      color: #60a5fa;
    }

    .empty-state h3 {
      color: #f9fafb;
    }
  }
</style>
