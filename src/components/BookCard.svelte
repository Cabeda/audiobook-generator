<script lang="ts">
  import type { BookMetadata } from '../lib/libraryDB'

  interface Props {
    book: BookMetadata
    onload: (book: BookMetadata) => void
    ondelete: (book: BookMetadata) => void
  }

  let { book, onload, ondelete }: Props = $props()

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
</script>

<div class="book-card" onclick={handleLoad} role="button" tabindex="0">
  <div class="book-cover">
    {#if book.cover}
      <img src={book.cover} alt={`Cover of ${book.title}`} />
    {:else}
      <div class="no-cover">
        <span class="book-icon">📚</span>
      </div>
    {/if}
    <button
      class="delete-btn"
      onclick={handleDelete}
      disabled={deleting}
      aria-label={`Delete ${book.title}`}
    >
      {deleting ? '...' : '🗑️'}
    </button>
  </div>

  <div class="book-info">
    <h3 class="book-title">{book.title}</h3>
    <p class="book-author">{book.author}</p>
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

<style>
  .book-card {
    background: white;
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    position: relative;
  }

  .book-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  }

  .book-card:active {
    transform: translateY(-2px);
  }

  .book-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 2 / 3;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    overflow: hidden;
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

  .book-icon {
    font-size: 4rem;
    opacity: 0.6;
  }

  .delete-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 6px;
    padding: 8px;
    font-size: 1.2rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s ease;
    z-index: 10;
  }

  .book-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(220, 38, 38, 0.9);
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .book-info {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .book-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #1f2937;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
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

  .last-accessed {
    font-weight: 500;
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
  }
</style>
