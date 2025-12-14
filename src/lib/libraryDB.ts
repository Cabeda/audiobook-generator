import type { Book } from './types/book'
import type { AudioSegment } from './types/audio'

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
const DB_VERSION = 4
const STORE_NAME = 'books'
const AUDIO_STORE_NAME = 'chapterAudio'
const SEGMENT_STORE_NAME = 'chapterSegments'

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

      // v4: Create segments store
      if (!db.objectStoreNames.contains(SEGMENT_STORE_NAME)) {
        const segmentStore = db.createObjectStore(SEGMENT_STORE_NAME, {
          keyPath: ['bookId', 'chapterId', 'index'],
        })
        segmentStore.createIndex('bookId', 'bookId', { unique: false })
        segmentStore.createIndex('chapterId', ['bookId', 'chapterId'], { unique: false })
      }
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
 * Update the content of a specific chapter
 */
export async function updateChapterContent(
  bookId: number,
  chapterId: string,
  newContent: string
): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(bookId)

    request.onsuccess = () => {
      const book = request.result as LibraryBook
      if (book) {
        const chapterIndex = book.chapters.findIndex((c) => c.id === chapterId)
        if (chapterIndex !== -1) {
          book.chapters[chapterIndex].content = newContent
          store.put(book)
          resolve()
        } else {
          reject(new Error('Chapter not found'))
        }
      } else {
        reject(new Error('Book not found'))
      }
    }

    request.onerror = () => reject(new Error('Failed to get book for updating content'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Update the language of a specific chapter
 */
export async function updateChapterLanguage(
  bookId: number,
  chapterId: string,
  language: string | undefined
): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(bookId)

    request.onsuccess = () => {
      const book = request.result as LibraryBook
      if (book) {
        const chapterIndex = book.chapters.findIndex((c) => c.id === chapterId)
        if (chapterIndex !== -1) {
          book.chapters[chapterIndex].language = language
          const putRequest = store.put(book)
          putRequest.onsuccess = () => resolve()
          putRequest.onerror = () => reject(new Error('Failed to save chapter language'))
        } else {
          reject(new Error('Chapter not found'))
        }
      } else {
        reject(new Error('Book not found'))
      }
    }

    request.onerror = () => reject(new Error('Failed to get book for updating language'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Update the language of the book
 */
export async function updateBookLanguage(bookId: number, language: string): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(bookId)

    request.onsuccess = () => {
      const book = request.result as LibraryBook
      if (book) {
        book.language = language
        const putRequest = store.put(book)
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(new Error('Failed to save book language'))
      } else {
        reject(new Error('Book not found'))
      }
    }

    request.onerror = () => reject(new Error('Failed to update book language'))
    transaction.oncomplete = () => db.close()
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
 * Returns the set of chapter IDs that have generated segments in the database for the given book.
 */
export async function getBookGenerationStatus(bookId: number): Promise<Set<string>> {
  const db = await openDB()

  return new Promise((resolve) => {
    // Check segments store
    if (!db.objectStoreNames.contains(SEGMENT_STORE_NAME)) {
      db.close()
      resolve(new Set())
      return
    }

    const transaction = db.transaction(SEGMENT_STORE_NAME, 'readonly')
    const store = transaction.objectStore(SEGMENT_STORE_NAME)
    const index = store.index('bookId')
    const request = index.getAllKeys(IDBKeyRange.only(bookId))

    request.onsuccess = () => {
      const result = request.result
      const generatedChapterIds = new Set<string>()

      // Result is array of keys: [bookId, chapterId, index]
      for (const key of result) {
        if (Array.isArray(key) && key.length >= 2) {
          generatedChapterIds.add(key[1] as string)
        }
      }
      resolve(generatedChapterIds)
    }

    request.onerror = () => {
      console.warn('Failed to check generation status', request.error)
      resolve(new Set()) // Fail safe
    }
  })
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
    const transaction = db.transaction(
      [STORE_NAME, AUDIO_STORE_NAME, SEGMENT_STORE_NAME],
      'readwrite'
    )
    const bookStore = transaction.objectStore(STORE_NAME)
    const audioStore = transaction.objectStore(AUDIO_STORE_NAME)

    const segmentStore = transaction.objectStore(SEGMENT_STORE_NAME)

    const bookRequest = bookStore.clear()
    const audioRequest = audioStore.clear()
    const segmentRequest = segmentStore.clear()

    const handleError = () => reject(new Error('Failed to clear library'))
    bookRequest.onerror = handleError
    audioRequest.onerror = handleError
    segmentRequest.onerror = handleError

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
  language?: string
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
 * Save audio segments for a chapter
 */
export async function saveChapterSegments(
  bookId: number,
  chapterId: string,
  segments: AudioSegment[]
): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SEGMENT_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(SEGMENT_STORE_NAME)

    segments.forEach((segment) => {
      store.put({
        ...segment,
        bookId,
        chapterId,
      })
    })

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      reject(new Error('Failed to save chapter segments'))
    }
  })
}

/**
 * Get all audio segments for a chapter
 */
export async function getChapterSegments(
  bookId: number,
  chapterId: string
): Promise<AudioSegment[]> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SEGMENT_STORE_NAME, 'readonly')
    const store = transaction.objectStore(SEGMENT_STORE_NAME)
    const index = store.index('chapterId')
    // Query by composite key [bookId, chapterId]
    const request = index.getAll(IDBKeyRange.only([bookId, chapterId]))

    request.onsuccess = () => {
      const results = request.result || []
      // Sort by index just in case
      results.sort((a, b) => a.index - b.index)
      resolve(results as AudioSegment[])
    }

    request.onerror = () => reject(new Error('Failed to get chapter segments'))
    transaction.oncomplete = () => db.close()
  })
}

/**
 * Delete all audio for a specific book (including segments)
 */
export async function deleteBookAudio(bookId: number): Promise<void> {
  const db = await openDB()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([AUDIO_STORE_NAME, SEGMENT_STORE_NAME], 'readwrite')

    // Delete from main audio store
    const audioStore = transaction.objectStore(AUDIO_STORE_NAME)
    const audioIndex = audioStore.index('bookId')
    const audioRequest = audioIndex.openKeyCursor(IDBKeyRange.only(bookId))

    audioRequest.onsuccess = () => {
      const cursor = audioRequest.result
      if (cursor) {
        audioStore.delete(cursor.primaryKey)
        cursor.continue()
      }
    }

    // Delete from segments store
    const segmentStore = transaction.objectStore(SEGMENT_STORE_NAME)
    const segmentIndex = segmentStore.index('bookId')
    const segmentRequest = segmentIndex.openKeyCursor(IDBKeyRange.only(bookId))

    segmentRequest.onsuccess = () => {
      const cursor = segmentRequest.result
      if (cursor) {
        segmentStore.delete(cursor.primaryKey)
        cursor.continue()
      }
    }

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => reject(new Error('Failed to delete book audio'))
  })
}
