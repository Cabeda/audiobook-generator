/**
 * Storage management utilities for IndexedDB and localStorage
 */

const DB_NAME = 'AudiobookLibrary'

export interface StorageInfo {
  totalSize: number
  books: number
  audio: number
  segments: number
  models: CachedModel[]
}

export interface CachedModel {
  name: string
  size: number
  lastAccessed?: number
}

/**
 * Get storage usage information
 */
export async function getStorageInfo(): Promise<StorageInfo> {
  const info: StorageInfo = {
    totalSize: 0,
    books: 0,
    audio: 0,
    segments: 0,
    models: [],
  }

  try {
    // Get IndexedDB usage
    const db = await openDB()

    // Count books
    const booksStore = db.transaction('books', 'readonly').objectStore('books')
    info.books = await countStore(booksStore)

    // Count audio
    const audioStore = db.transaction('chapterAudio', 'readonly').objectStore('chapterAudio')
    info.audio = await countStore(audioStore)

    // Count segments
    const segmentsStore = db
      .transaction('chapterSegments', 'readonly')
      .objectStore('chapterSegments')
    info.segments = await countStore(segmentsStore)

    db.close()

    // Get cached models from IndexedDB
    info.models = await getCachedModels()

    // Estimate total size
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate()
      info.totalSize = estimate.usage || 0
    }
  } catch (e) {
    console.warn('Failed to get storage info:', e)
  }

  return info
}

/**
 * Get list of cached TTS models
 */
async function getCachedModels(): Promise<CachedModel[]> {
  const models: CachedModel[] = []

  try {
    // Check for Kokoro models in IndexedDB
    const kokoroDB = await openModelDB('kokoro-cache')
    if (kokoroDB) {
      const store = kokoroDB.transaction('models', 'readonly').objectStore('models')
      const keys = await getAllKeys(store)
      for (const key of keys) {
        models.push({
          name: `Kokoro: ${key}`,
          size: 0, // Size not easily available
        })
      }
      kokoroDB.close()
    }

    // Check for Piper models
    const piperDB = await openModelDB('piper-cache')
    if (piperDB) {
      const store = piperDB.transaction('models', 'readonly').objectStore('models')
      const keys = await getAllKeys(store)
      for (const key of keys) {
        models.push({
          name: `Piper: ${key}`,
          size: 0,
        })
      }
      piperDB.close()
    }
  } catch (e) {
    console.warn('Failed to get cached models:', e)
  }

  return models
}

/**
 * Delete all library data (books, audio, segments)
 */
export async function clearLibraryData(): Promise<void> {
  const db = await openDB()

  await clearStore(db, 'books')
  await clearStore(db, 'chapterAudio')
  await clearStore(db, 'chapterSegments')

  db.close()
}

/**
 * Delete all cached models
 */
export async function clearModelCache(): Promise<void> {
  try {
    await deleteDatabase('kokoro-cache')
    await deleteDatabase('piper-cache')
  } catch (e) {
    console.warn('Failed to clear model cache:', e)
  }
}

/**
 * Delete everything (library + models + localStorage)
 */
export async function clearAllData(): Promise<void> {
  await clearLibraryData()
  await clearModelCache()
  localStorage.clear()
  sessionStorage.clear()
}

// Helper functions

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openModelDB(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function countStore(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getAllKeys(store: IDBObjectStore): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAllKeys()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
