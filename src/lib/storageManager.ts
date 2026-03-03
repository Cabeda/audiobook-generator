/**
 * Storage management utilities for IndexedDB, Cache API, and localStorage
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
  cacheName: string
  cacheKey: string
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
    // Get IndexedDB usage — open without version to avoid triggering upgrades.
    // If the DB doesn't exist yet or stores are missing, we just return zeros.
    const db = await openDB()
    const storeNames = Array.from(db.objectStoreNames)

    if (storeNames.includes('books')) {
      const booksStore = db.transaction('books', 'readonly').objectStore('books')
      info.books = await countStore(booksStore)
    }

    if (storeNames.includes('chapterAudio')) {
      const audioStore = db.transaction('chapterAudio', 'readonly').objectStore('chapterAudio')
      info.audio = await countStore(audioStore)
    }

    if (storeNames.includes('chapterSegments')) {
      const segmentsStore = db
        .transaction('chapterSegments', 'readonly')
        .objectStore('chapterSegments')
      info.segments = await countStore(segmentsStore)
    }

    db.close()

    // Get cached models from Cache API
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
 * Extract a human-readable model name from a cache URL
 */
function extractModelName(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname

    // Extract filename from path
    const parts = path.split('/')
    const filename = parts[parts.length - 1] || ''

    // Try to extract model info from the path
    // e.g. /onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_fp32.onnx
    // -> "Kokoro-82M-v1.0 / model_fp32.onnx"
    const repoMatch = path.match(/\/([^/]+\/[^/]+)\/resolve\//)
    if (repoMatch) {
      const repo = repoMatch[1].replace('onnx-community/', '')
      return `${repo} / ${filename}`
    }

    // For piper voices: extract voice name from URL
    // e.g. /piper/en_US-lessac-medium.onnx -> "en_US-lessac-medium.onnx"
    if (filename.endsWith('.onnx') || filename.endsWith('.json')) {
      return filename
    }

    // Fallback: last 2 path segments
    if (parts.length >= 2) {
      return parts.slice(-2).join('/')
    }

    return filename || url.substring(0, 60)
  } catch {
    return url.substring(0, 60)
  }
}

/**
 * Get list of cached TTS models from Cache API with sizes
 */
async function getCachedModels(): Promise<CachedModel[]> {
  const models: CachedModel[] = []

  if (typeof caches === 'undefined') return models

  try {
    const cacheNames = await caches.keys()

    for (const cacheName of cacheNames) {
      // Only look at model-related caches
      if (
        !cacheName.includes('kokoro') &&
        !cacheName.includes('piper') &&
        !cacheName.includes('model') &&
        !cacheName.includes('onnx') &&
        !cacheName.includes('transformers')
      ) {
        continue
      }

      const cache = await caches.open(cacheName)
      const keys = await cache.keys()

      for (const request of keys) {
        let size = 0
        try {
          const response = await cache.match(request)
          if (response) {
            // Only use content-length header — reading the full blob is too slow
            // for large model files (hundreds of MB) and causes the UI to hang.
            const contentLength = response.headers.get('content-length')
            if (contentLength) {
              size = parseInt(contentLength, 10)
            }
          }
        } catch {
          // ignore size errors
        }

        models.push({
          name: extractModelName(request.url),
          size,
          cacheName,
          cacheKey: request.url,
        })
      }
    }
  } catch (e) {
    console.warn('Failed to get cached models:', e)
  }

  // Deduplicate by URL — the same file can appear in multiple caches
  // (e.g. both a versioned and an unversioned cache). Duplicate keys cause
  // a Svelte each_key_duplicate error that crashes the SettingsPage render.
  const seen = new Set<string>()
  const unique = models.filter((m) => {
    if (seen.has(m.cacheKey)) return false
    seen.add(m.cacheKey)
    return true
  })

  // Sort by size descending
  unique.sort((a, b) => b.size - a.size)

  return unique
}

/**
 * Delete a single cached model entry
 */
export async function deleteCachedModel(cacheName: string, cacheKey: string): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(cacheName)
    await cache.delete(cacheKey)
  } catch (e) {
    console.warn('Failed to delete cached model:', e)
    throw e
  }
}

/**
 * Delete all library data (books, audio, segments)
 */
export async function clearLibraryData(): Promise<void> {
  const db = await openDB()
  const storeNames = Array.from(db.objectStoreNames)

  if (storeNames.includes('books')) await clearStore(db, 'books')
  if (storeNames.includes('chapterAudio')) await clearStore(db, 'chapterAudio')
  if (storeNames.includes('chapterSegments')) await clearStore(db, 'chapterSegments')

  db.close()
}

/**
 * Delete all cached models
 */
export async function clearModelCache(): Promise<void> {
  try {
    // Clear IndexedDB model caches
    await deleteDatabase('kokoro-cache')
    await deleteDatabase('piper-cache')

    // Clear Cache API model caches
    if (typeof caches !== 'undefined') {
      const cacheNames = await caches.keys()
      for (const name of cacheNames) {
        if (
          name.includes('kokoro') ||
          name.includes('piper') ||
          name.includes('model') ||
          name.includes('onnx') ||
          name.includes('transformers')
        ) {
          await caches.delete(name)
        }
      }
    }
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

function countStore(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count()
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
