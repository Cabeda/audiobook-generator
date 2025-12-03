import type { Book } from './types/book'

/**
 * Extended Book interface for library storage
 */
export interface LibraryBook extends Book {
  id?: number // Auto-increment ID from IndexedDB
  dateAdded: number // Timestamp
  lastAccessed: number // Timestamp
  fileSize?: number // Original file size in bytes
  sourceUrl?: string // If loaded from URL
}

/**
 * Lightweight book metadata for listing (without chapter content)
 */
export interface BookMetadata {
  id: number
  title: string
  author: string
  cover?: string
  format?: string
  language?: string
  dateAdded: number
  lastAccessed: number
  fileSize?: number
  sourceUrl?: string
  chapterCount: number
}

const DB_NAME = 'AudiobookLibrary'
const DB_VERSION = 3
const STORE_NAME = 'books'
const AUDIO_STORE_NAME = 'chapterAudio'

/**
 * Initialize and return the IndexedDB database
 */
async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      reject(new Error('Failed to open database'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion

      // Create books store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        })

        // Create indexes for searching and sorting
        objectStore.createIndex('title', 'title', { unique: false })
        objectStore.createIndex('author', 'author', { unique: false })
        objectStore.createIndex('dateAdded', 'dateAdded', { unique: false })
        objectStore.createIndex('lastAccessed', 'lastAccessed', { unique: false })
      }

      // Create audio store if it doesn't exist (v2+)
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        const audioStore = db.createObjectStore(AUDIO_STORE_NAME, {
          keyPath: ['bookId', 'chapterId'],
        })
        // Index for querying by bookId to delete all audio for a book
        audioStore.createIndex('bookId', 'bookId', { unique: false })
      }

      // v3: No schema changes needed, existing records will have undefined settings
      // which is handled gracefully in the code
    }
  })
}

/**
 * Add or update a book in the library
 */
export async function addBook(book: Book, sourceFile?: File, sourceUrl?: string): Promise<number> {
  const db = await openDB()

  const libraryBook: LibraryBook = {
    ...book,
    dateAdded: Date.now(),
    lastAccessed: Date.now(),
    fileSize: sourceFile?.size,
    sourceUrl,
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.add(libraryBook)

    request.onsuccess = () => {
      resolve(request.result as number)
    }

    request.onerror = () => {
      reject(new Error('Failed to add book to library'))
    }

    transaction.oncomplete = () => {
      db.close()
    }
  })
}

/**
 * Get a book by ID (includes full chapter content)
 */
export async function getBook(id: number): Promise<LibraryBook | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(id)

    request.onsuccess = () => {
      resolve(request.result || null)
    }

    request.onerror = () => {
      reject(new Error('Failed to get book from library'))
    }

    transaction.oncomplete = () => {
      db.close()
    }
  })
}

/**
 * Get all books metadata (without full chapter content for performance)
 */
export async function getAllBooksMetadata(): Promise<BookMetadata[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.getAll()

    request.onsuccess = () => {
      const books: LibraryBook[] = request.result || []
      // Convert to metadata only (lightweight)
      const metadata: BookMetadata[] = books.map((book) => ({
        id: book.id!,
        title: book.title,
        author: book.author,
        cover: book.cover,
        format: book.format,
        language: book.language,
        dateAdded: book.dateAdded,
        lastAccessed: book.lastAccessed,
        fileSize: book.fileSize,
        sourceUrl: book.sourceUrl,
        chapterCount: book.chapters.length,
      }))
      resolve(metadata)
    }

    request.onerror = () => {
      reject(new Error('Failed to get books from library'))
    }

    transaction.oncomplete = () => {
      db.close()
    }
  })
}

/**
 * Update the last accessed timestamp for a book
 */
export async function updateLastAccessed(id: number): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const book = getRequest.result
      if (book) {
        book.lastAccessed = Date.now()
        const updateRequest = store.put(book)

        updateRequest.onsuccess = () => {
          resolve()
        }

        updateRequest.onerror = () => {
          reject(new Error('Failed to update last accessed time'))
        }
      } else {
        reject(new Error('Book not found'))
      }
    }

    getRequest.onerror = () => {
      reject(new Error('Failed to get book for update'))
    }

    transaction.oncomplete = () => {
      db.close()
    }
  })
}

/**
 * Delete a book from the library
 */
export async function deleteBook(id: number): Promise<void> {
  const db = await openDB()

  // First delete all associated audio
  await deleteBookAudio(id)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.delete(id)

    request.onsuccess = () => {
      resolve()
    }

    request.onerror = () => {
      reject(new Error('Failed to delete book from library'))
    }

    transaction.oncomplete = () => {
      db.close()
    }
  })
}

/**
 * Search books by title or author
 */
export async function searchBooks(query: string): Promise<BookMetadata[]> {
  const allBooks = await getAllBooksMetadata()
  const lowerQuery = query.toLowerCase()

  return allBooks.filter(
    (book) =>
      book.title.toLowerCase().includes(lowerQuery) ||
      book.author.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Get estimated storage usage (approximate)
 */
export async function getStorageUsage(): Promise<{
  usage: number
  quota: number
  percentage: number
}> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage || 0
    const quota = estimate.quota || 0
    const percentage = quota > 0 ? (usage / quota) * 100 : 0

    return { usage, quota, percentage }
  }

  // Fallback: estimate based on book data
  const books = await getAllBooksMetadata()
  const estimatedUsage = books.reduce((sum, book) => sum + (book.fileSize || 0), 0)

  return {
    usage: estimatedUsage,
    quota: 0,
    percentage: 0,
  }
}

/**
 * Check if a book already exists by title and author
 */
export async function findBookByTitleAuthor(
  title: string,
  author: string
): Promise<BookMetadata | null> {
  const allBooks = await getAllBooksMetadata()
  return allBooks.find((book) => book.title === title && book.author === author) || null
}

/**
 * Clear all books from the library (with confirmation in calling code)
 */
export async function clearLibrary(): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, AUDIO_STORE_NAME], 'readwrite')
    const bookStore = transaction.objectStore(STORE_NAME)
    const audioStore = transaction.objectStore(AUDIO_STORE_NAME)

    const bookRequest = bookStore.clear()
    const audioRequest = audioStore.clear()

    const handleError = () => reject(new Error('Failed to clear library'))
    bookRequest.onerror = handleError
    audioRequest.onerror = handleError

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      reject(new Error('Failed to clear library'))
    }
  })
}

// --- Audio Persistence Helpers ---

export interface AudioGenerationSettings {
  model: string
  voice: string
  quantization?: string
  device?: string
}

export interface ChapterAudioRecord {
  bookId: number
  chapterId: string
  audioBlob: Blob
  timestamp: number
  // Generation settings (v3+)
  settings?: AudioGenerationSettings
}

/**
 * Save generated audio for a chapter with generation settings
 */
export async function saveChapterAudio(
  bookId: number,
  chapterId: string,
  audioBlob: Blob,
  settings?: AudioGenerationSettings
): Promise<void> {
  const db = await openDB()

  const record: ChapterAudioRecord = {
    bookId,
    chapterId,
    audioBlob,
    timestamp: Date.now(),
    settings,
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(AUDIO_STORE_NAME)
    const request = store.put(record)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to save chapter audio'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Get generated audio for a chapter (blob only, for backward compatibility)
 */
export async function getChapterAudio(bookId: number, chapterId: string): Promise<Blob | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readonly')
    const store = transaction.objectStore(AUDIO_STORE_NAME)
    const request = store.get([bookId, chapterId])

    request.onsuccess = () => {
      const result = request.result as ChapterAudioRecord | undefined
      resolve(result ? result.audioBlob : null)
    }
    request.onerror = () => reject(new Error('Failed to get chapter audio'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Get generated audio with settings for a chapter
 */
export async function getChapterAudioWithSettings(
  bookId: number,
  chapterId: string
): Promise<{ blob: Blob; settings?: AudioGenerationSettings } | null> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readonly')
    const store = transaction.objectStore(AUDIO_STORE_NAME)
    const request = store.get([bookId, chapterId])

    request.onsuccess = () => {
      const result = request.result as ChapterAudioRecord | undefined
      resolve(result ? { blob: result.audioBlob, settings: result.settings } : null)
    }
    request.onerror = () => reject(new Error('Failed to get chapter audio'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Delete all audio for a specific book
 */
export async function deleteBookAudio(bookId: number): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(AUDIO_STORE_NAME)
    const index = store.index('bookId')
    const request = index.openKeyCursor(IDBKeyRange.only(bookId))

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        store.delete(cursor.primaryKey)
        cursor.continue()
      } else {
        // No more entries
        resolve()
      }
    }

    request.onerror = () => reject(new Error('Failed to delete book audio'))
    transaction.oncomplete = () => db.close()
  })
}
