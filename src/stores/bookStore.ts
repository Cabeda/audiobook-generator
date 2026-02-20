import { writable, derived, get, type Writable } from 'svelte/store'
import type { Book } from '../lib/types/book'

// Book state store
export const book: Writable<Book | null> = writable(null)

// Reset derived stores when book changes

// Chapter selection state (Map of chapter id -> boolean)
export const selectedChapters = writable(new Map<string, boolean>())

// Generated audio state (Map of chapter id -> {url, blob})
// Only populated on-demand (during generation or when user plays/exports)
export const generatedAudio = writable(new Map<string, { url: string; blob: Blob }>())

// Global generation state
export const isGenerating = writable(false)

// Chapter status tracking
export type ChapterStatus = 'pending' | 'processing' | 'done' | 'error'
export const chapterStatus = writable(new Map<string, ChapterStatus>())
export const chapterErrors = writable(new Map<string, string>())

export interface ChapterProgress {
  current: number
  total: number
  message?: string
}
export const chapterProgress = writable(new Map<string, ChapterProgress>())

// Track the current library book ID for lazy audio loading
let currentBookDatabaseId: number | null = null

/**
 * Lazily load a single chapter's audio from IndexedDB into the generatedAudio store.
 * Returns the audio data if found, or null.
 */
export async function ensureChapterAudio(
  chapterId: string
): Promise<{ url: string; blob: Blob } | null> {
  // Already in memory?
  const existing = get(generatedAudio).get(chapterId)
  if (existing) return existing

  if (!currentBookDatabaseId) return null

  try {
    const { getChapterAudio } = await import('../lib/libraryDB')
    const blob = await getChapterAudio(currentBookDatabaseId, chapterId)
    if (blob) {
      const entry = { url: URL.createObjectURL(blob), blob }
      generatedAudio.update((map) => {
        const newMap = new Map(map)
        newMap.set(chapterId, entry)
        return newMap
      })
      return entry
    }
  } catch (e) {
    console.warn('Failed to lazy-load audio for chapter', chapterId, e)
  }
  return null
}

/**
 * Lazily load audio for multiple chapters. Used by export flows.
 */
export async function ensureChaptersAudio(chapterIds: string[]): Promise<void> {
  const current = get(generatedAudio)
  const missing = chapterIds.filter((id) => !current.has(id))
  if (missing.length === 0) return

  await Promise.all(missing.map((id) => ensureChapterAudio(id)))
}

// Helper to get selected chapter IDs
export const selectedChapterIds = derived(selectedChapters, ($selectedChapters) => {
  return Array.from($selectedChapters.entries())
    .filter(([_, selected]) => selected)
    .map(([id]) => id)
})

// Helper to get selected chapters with full data
export const selectedChaptersWithData = derived(
  [book, selectedChapters],
  ([$book, $selectedChapters]) => {
    if (!$book) return []
    return $book.chapters.filter((ch) => $selectedChapters.get(ch.id))
  }
)

import { getBookGenerationStatus } from '../lib/libraryDB'
import { segmentProgress } from './segmentProgressStore'

// Track the previous book's cover URL for cleanup
let previousCoverUrl: string | null = null

book.subscribe((b) => {
  // Clear segment progress from previous book to free audioBlob memory
  const oldSegments = get(segmentProgress)
  if (oldSegments.size > 0) {
    segmentProgress.set(new Map())
  }

  // Revoke old cover image blob URL if present
  if (previousCoverUrl && previousCoverUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(previousCoverUrl)
    } catch {
      // ignore
    }
  }
  previousCoverUrl = b?.cover ?? null

  if (b) {
    // Initialize status for new book
    const statusMap = new Map<string, ChapterStatus>()
    b.chapters.forEach((ch) => statusMap.set(ch.id, 'pending'))
    chapterStatus.set(statusMap)

    // Revoke old blob URLs before clearing to prevent memory leaks
    const oldAudio = get(generatedAudio)
    for (const entry of oldAudio.values()) {
      try {
        URL.revokeObjectURL(entry.url)
      } catch {
        // ignore
      }
    }
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    chapterProgress.set(new Map())
    selectedChapters.set(new Map(b.chapters.map((c) => [c.id, true])))

    if ('id' in b && typeof b.id === 'number') {
      currentBookDatabaseId = b.id

      // Only hydrate chapterStatus (lightweight — just IDs, no blobs)
      getBookGenerationStatus(currentBookDatabaseId!)
        .then((generatedIds) => {
          chapterStatus.update((map) => {
            const newMap = new Map(map)
            generatedIds.forEach((id) => newMap.set(id, 'done'))
            return newMap
          })
        })
        .catch((err) => {
          console.warn('Failed to hydrate generation status', err)
        })
    } else {
      currentBookDatabaseId = null
    }
  } else {
    currentBookDatabaseId = null
    chapterStatus.set(new Map())
    // Revoke old blob URLs before clearing
    const oldAudio = get(generatedAudio)
    for (const entry of oldAudio.values()) {
      try {
        URL.revokeObjectURL(entry.url)
      } catch {
        // ignore
      }
    }
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    chapterProgress.set(new Map())
    selectedChapters.set(new Map())
  }
})
