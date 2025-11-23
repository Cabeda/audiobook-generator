import { writable, type Writable } from 'svelte/store'
import type { BookMetadata } from '../lib/libraryDB'
import { getAllBooksMetadata, deleteBook as deleteBookFromDB } from '../lib/libraryDB'

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
    console.error('Failed to load library:', err)
    libraryError.set(err instanceof Error ? err.message : 'Failed to load library')
    libraryBooks.set([])
  } finally {
    libraryLoading.set(false)
  }
}

/**
 * Remove a book from the library
 */
export async function removeBookFromLibrary(id: number) {
  try {
    await deleteBookFromDB(id)
    await refreshLibrary()

    // If the deleted book is currently loaded, clear the ID
    currentLibraryBookId.update((currentId) => (currentId === id ? null : currentId))
  } catch (err) {
    console.error('Failed to delete book:', err)
    throw err
  }
}
