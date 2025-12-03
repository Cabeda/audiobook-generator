import { writable, type Writable } from 'svelte/store'
import logger from '../lib/utils/logger'
import type { BookMetadata } from '../lib/libraryDB'
import { getAllBooksMetadata, deleteBook as deleteBookFromDB } from '../lib/libraryDB'
import { toastStore } from './toastStore'

// Library books state (metadata only)
export const libraryBooks: Writable<BookMetadata[]> = writable([])

// Loading and error states
export const libraryLoading = writable(false)
export const libraryError: Writable<string | null> = writable(null)

// Current library book ID (if loaded from library)
export const currentLibraryBookId: Writable<number | null> = writable(null)

/**
 * Refresh the library from IndexedDB
 */
export async function refreshLibrary() {
  libraryLoading.set(true)
  libraryError.set(null)

  try {
    const books = await getAllBooksMetadata()
    // Sort by last accessed (most recent first)
    books.sort((a, b) => b.lastAccessed - a.lastAccessed)
    libraryBooks.set(books)
  } catch (err) {
    logger.error('Failed to load library:', err)
    libraryError.set(err instanceof Error ? err.message : 'Failed to load library')
    libraryBooks.set([])
  } finally {
    libraryLoading.set(false)
  }
}

/**
 * Remove a book from the library with optimistic UI updates
 */
export async function removeBookFromLibrary(id: number) {
  // Store the current state for rollback
  let previousBooks: BookMetadata[] = []

  try {
    // Optimistically update UI immediately
    libraryBooks.update((books) => {
      previousBooks = books
      return books.filter((b) => b.id !== id)
    })

    // Perform actual deletion
    await deleteBookFromDB(id)

    // If the deleted book is currently loaded, clear the ID
    currentLibraryBookId.update((currentId) => (currentId === id ? null : currentId))

    toastStore.success('Book removed from library')
  } catch (err) {
    logger.error('Failed to delete book:', err)

    // Rollback UI on error
    libraryBooks.set(previousBooks)

    toastStore.error('Failed to delete book')
    throw err
  }
}
