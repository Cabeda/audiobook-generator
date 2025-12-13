<script lang="ts">
  import type { BookMetadata } from '../lib/libraryDB'

  interface Props {
    book: BookMetadata
    viewMode?: 'grid' | 'list'
    onload: (book: BookMetadata) => void
    ondelete: (book: BookMetadata) => void
  }

  let { book, viewMode = 'grid', onload, ondelete }: Props = $props()

  let deleting = $state(false)

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
    return date.toLocaleDateString()
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return ''
    const kb = bytes / 1024
    const mb = kb / 1024
    if (mb > 1) return `${mb.toFixed(1)} MB`
    return `${kb.toFixed(0)} KB`
  }

  function handleLoad() {
    onload(book)
  }

  async function handleDelete(e: MouseEvent) {
    e.stopPropagation()
    if (
      confirm(
        `Are you sure you want to remove "${book.title}" from your library?\n\nThis will delete the book and all its data.`
      )
    ) {
      deleting = true
      try {
        await ondelete(book)
      } catch (err) {
        console.error('Delete failed:', err)
        alert('Failed to delete book')
        deleting = false
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    // Load book on Enter or Space
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleLoad()
    }
    // Delete book on Delete key
    if (e.key === 'Delete') {
      e.preventDefault()
      handleDelete(e as unknown as MouseEvent)
    }
  }
</script>

<div
  class="book-card"
  class:list-view={viewMode === 'list'}
  onclick={handleLoad}
  onkeydown={handleKeydown}
  role="button"
  tabindex="0"
>
  <div class="book-cover">
    {#if book.cover}
      <img src={book.cover} alt={`Cover of ${book.title}`} loading="lazy" decoding="async" />
    {:else}
      <div class="no-cover">
        <span class="book-icon">📚</span>
      </div>
    {/if}
    {#if viewMode === 'grid'}
      <button
        class="delete-btn"
        onclick={handleDelete}
        disabled={deleting}
        aria-label={`Delete ${book.title}`}
      >
        {deleting ? '...' : '🗑️'}
      </button>
    {/if}
  </div>

  <div class="book-info">
    <div class="info-header">
      <h3 class="book-title">{book.title}</h3>
      <p class="book-author">{book.author}</p>
    </div>

    <div class="info-details">
      <div class="book-meta">
        <span class="format-badge">{book.format?.toUpperCase() || 'UNKNOWN'}</span>
        <span class="chapter-count">{book.chapterCount} chapters</span>
      </div>
      <div class="book-footer">
        <span class="last-accessed">{formatDate(book.lastAccessed)}</span>
        {#if book.fileSize}
          <span class="file-size">{formatSize(book.fileSize)}</span>
        {/if}
      </div>
    </div>
  </div>

  {#if viewMode === 'list'}
    <button
      class="delete-btn-list"
      onclick={handleDelete}
      disabled={deleting}
      aria-label={`Delete ${book.title}`}
      title={`Delete "${book.title}"`}
    >
      {deleting ? '⏳' : '🗑️'}
    </button>
  {/if}
</div>

<style>
  .book-card {
    background: white;
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .book-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }

  .book-card:active {
    transform: translateY(-2px);
  }

  /* List View Overrides */
  .book-card.list-view {
    flex-direction: row;
    height: auto;
    align-items: center;
    padding: 12px 16px;
    gap: 16px;
    border-radius: 8px;
  }

  .book-card.list-view:hover {
    transform: translateX(2px);
  }

  .book-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 3;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    overflow: hidden;
  }

  .book-card.list-view .book-cover {
    width: 60px;
    height: 90px;
    min-width: 60px;
    /* Maintain proper aspect ratio without full width */
    aspect-ratio: auto;
    border-radius: 4px;
  }

  .book-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .no-cover {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .book-card.list-view .book-icon {
    font-size: 2rem;
  }

  .book-icon {
    font-size: 4rem;
    opacity: 0.6;
  }

  .delete-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    border-radius: 6px;
    padding: 6px;
    font-size: 1.1rem;
    cursor: pointer;
    opacity: 1;
    transition: all 0.2s ease;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    min-height: 32px;
  }

  .delete-btn:hover {
    background: rgba(220, 38, 38, 0.9);
    transform: scale(1.1);
  }

  .delete-btn:active {
    transform: scale(0.95);
  }

  .delete-btn-list {
    background: transparent;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 1rem;
    cursor: pointer;
    color: #6b7280;
    transition: all 0.2s ease;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }

  .delete-btn-list:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
    border-color: #dc2626;
    transform: scale(1.05);
  }

  .delete-btn-list:active {
    transform: scale(0.95);
  }

  .delete-btn:disabled,
  .delete-btn-list:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .book-info {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .book-card.list-view .book-info {
    padding: 0;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex: 1;
  }

  .info-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0; /* Allow text truncation */
  }

  .info-details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .book-card.list-view .info-details {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-width: 0;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .book-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #1f2937;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  .book-author {
    margin: 0;
    font-size: 0.875rem;
    color: #6b7280;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .book-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .format-badge {
    background: #e5e7eb;
    color: #374151;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .chapter-count {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .book-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.75rem;
    color: #9ca3af;
    margin-top: 4px;
  }

  .book-card.list-view .book-footer {
    margin-top: 0;
    gap: 16px;
  }

  .last-accessed {
    font-weight: 500;
  }

  /* Responsive for list view - Tablets & Medium screens (768px and below) */
  @media (max-width: 768px) {
    .book-card.list-view {
      padding: 12px;
      gap: 12px;
    }

    .book-card.list-view .book-cover {
      width: 50px;
      height: 75px;
    }

    .book-meta {
      gap: 6px;
    }

    .format-badge {
      font-size: 0.7rem;
      padding: 2px 6px;
    }

    .chapter-count {
      font-size: 0.7rem;
    }

    .book-card.list-view .info-details {
      gap: 8px;
      font-size: 0.8rem;
    }

    .delete-btn-list {
      min-width: 40px;
      min-height: 40px;
      padding: 6px 8px;
      font-size: 0.9rem;
    }
  }

  /* Responsive for list view - Mobile phones (640px and below) */
  @media (max-width: 640px) {
    .book-card.list-view {
      padding: 10px 12px;
      gap: 10px;
    }

    .book-card.list-view .book-cover {
      width: 45px;
      height: 67px;
      border-radius: 3px;
    }

    .book-icon {
      font-size: 2rem;
    }

    .book-title {
      font-size: 0.9rem;
    }

    .book-author {
      font-size: 0.75rem;
    }

    .format-badge {
      font-size: 0.65rem;
      padding: 2px 5px;
    }

    .chapter-count {
      font-size: 0.65rem;
    }

    .book-card.list-view .info-details {
      display: none; /* Hide details on very small screens to keep compact */
    }

    .book-meta {
      display: none; /* Hide meta on very small screens */
    }

    .delete-btn-list {
      min-width: 36px;
      min-height: 36px;
      padding: 4px 6px;
      font-size: 0.85rem;
      border: none;
      background: transparent;
    }

    .delete-btn-list:hover {
      background: rgba(239, 68, 68, 0.1);
    }
  }

  /* Very small phones (below 480px) */
  @media (max-width: 480px) {
    .book-card.list-view {
      padding: 8px 10px;
      gap: 8px;
    }

    .book-card.list-view .book-cover {
      width: 40px;
      height: 60px;
    }

    .book-title {
      font-size: 0.85rem;
    }

    .book-author {
      display: none; /* Hide author on very small screens */
    }

    .delete-btn-list {
      min-width: 32px;
      min-height: 32px;
      font-size: 0.8rem;
    }
  }

  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .book-card {
      background: #1f2937;
    }

    .book-title {
      color: #f9fafb;
    }

    .book-author {
      color: #9ca3af;
    }

    .format-badge {
      background: #374151;
      color: #d1d5db;
    }

    .delete-btn-list {
      background: transparent;
      border-color: #374151;
      color: #9ca3af;
    }

    .delete-btn-list:hover {
      background: rgba(239, 68, 68, 0.15);
      border-color: #dc2626;
      color: #fca5a5;
    }
  }
</style>
