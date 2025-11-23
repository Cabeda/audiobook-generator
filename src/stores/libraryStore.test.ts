import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  libraryBooks,
  libraryLoading,
  libraryError,
  refreshLibrary,
  removeBookFromLibrary,
  currentLibraryBookId,
} from '../stores/libraryStore'
import * as libraryDB from '../lib/libraryDB'
import { toastStore } from '../stores/toastStore'

// Mock libraryDB
vi.mock('../lib/libraryDB', () => ({
  getAllBooksMetadata: vi.fn(),
  deleteBook: vi.fn(),
}))

// Mock toastStore
vi.mock('../stores/toastStore', () => ({
  toastStore: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('libraryStore', () => {
  const mockBooks = [
    {
      id: 1,
      title: 'Book 1',
      author: 'Author 1',
      lastAccessed: 1000,
      dateAdded: 1000,
      format: 'epub',
      chapterCount: 5,
    },
    {
      id: 2,
      title: 'Book 2',
      author: 'Author 2',
      lastAccessed: 2000,
      dateAdded: 2000,
      format: 'epub',
      chapterCount: 10,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    libraryBooks.set([])
    libraryLoading.set(false)
    libraryError.set(null)
    currentLibraryBookId.set(null)
  })

  it('should refresh library and sort books', async () => {
    // @ts-expect-error - mocking resolved value
    libraryDB.getAllBooksMetadata.mockResolvedValue([...mockBooks])

    await refreshLibrary()

    const books = get(libraryBooks)
    expect(books).toHaveLength(2)
    // Should be sorted by lastAccessed desc
    expect(books[0].id).toBe(2)
    expect(books[1].id).toBe(1)
    expect(get(libraryLoading)).toBe(false)
    expect(get(libraryError)).toBeNull()
  })

  it('should handle refresh error', async () => {
    // @ts-expect-error - mocking rejected value
    libraryDB.getAllBooksMetadata.mockRejectedValue(new Error('DB Error'))

    await refreshLibrary()

    expect(get(libraryBooks)).toHaveLength(0)
    expect(get(libraryLoading)).toBe(false)
    expect(get(libraryError)).toBe('DB Error')
  })

  it('should remove book with optimistic update', async () => {
    // Setup initial state
    libraryBooks.set(mockBooks)
    currentLibraryBookId.set(1)

    // @ts-expect-error - mocking resolved value
    libraryDB.deleteBook.mockResolvedValue(undefined)

    await removeBookFromLibrary(1)

    // Check store updated
    const books = get(libraryBooks)
    expect(books).toHaveLength(1)
    expect(books[0].id).toBe(2)

    // Check DB called
    expect(libraryDB.deleteBook).toHaveBeenCalledWith(1)

    // Check current ID cleared
    expect(get(currentLibraryBookId)).toBeNull()

    // Check toast
    expect(toastStore.success).toHaveBeenCalled()
  })

  it('should rollback on delete error', async () => {
    // Setup initial state
    libraryBooks.set(mockBooks)

    // @ts-expect-error - mocking rejected value
    libraryDB.deleteBook.mockRejectedValue(new Error('Delete failed'))

    try {
      await removeBookFromLibrary(1)
    } catch {
      // Expected error
    }

    // Check rollback
    const books = get(libraryBooks)
    expect(books).toHaveLength(2)
    expect(books.find((b) => b.id === 1)).toBeDefined()

    // Check toast
    expect(toastStore.error).toHaveBeenCalled()
  })
})
