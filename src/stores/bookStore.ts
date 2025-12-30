import { writable, derived, type Writable } from 'svelte/store'
import type { Book } from '../lib/types/book'

// Book state store
export const book: Writable<Book | null> = writable(null)

// Reset derived stores when book changes

// Chapter selection state (Map of chapter id -> boolean)
export const selectedChapters = writable(new Map<string, boolean>())

// Generated audio state (Map of chapter id -> {url, blob})
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

// Reset derived stores when book changes
// Must be defined after all stores are initialized
// Helper to get selected chapter IDs
// ... imports need to be updated to include getBookGenerationStatus and currentLibraryBookId logic if we want auto-hydration
// But we cannot easily import currentLibraryBookId here due to potential circular dependencies if libraryStore imports bookStore.
// Instead, let's expose a rehydration function.
import { getBookGenerationStatus } from '../lib/libraryDB'

// ... existing code ...

book.subscribe((b) => {
  if (b) {
    // Initialize status for new book
    const statusMap = new Map<string, ChapterStatus>()
    b.chapters.forEach((ch) => statusMap.set(ch.id, 'pending'))
    chapterStatus.set(statusMap)

    // Clear other maps
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    chapterProgress.set(new Map())
    selectedChapters.set(new Map(b.chapters.map((c) => [c.id, true])))

    // Hydrate status from DB (if book has an ID that matches library)
    // We assume if book object has 'id' property that matches library ID, we can check.
    // The `Book` interface in types/book usually doesn't have `id` as database ID, but `LibraryBook` does.
    // Let's cast and check.
    const libBook = b as any
    if (libBook.id && typeof libBook.id === 'number') {
      const bookDatabaseId = libBook.id

      // Hydrate chapterStatus
      getBookGenerationStatus(bookDatabaseId)
        .then(async (generatedIds) => {
          chapterStatus.update((map) => {
            generatedIds.forEach((id) => map.set(id, 'done'))
            return map
          })

          // Hydrate generatedAudio for chapters that have audio in DB
          // This enables local playback in ChapterItem without regeneration
          const { getChapterAudio } = await import('../lib/libraryDB')
          for (const chapterId of generatedIds) {
            try {
              const blob = await getChapterAudio(bookDatabaseId, chapterId)
              if (blob) {
                generatedAudio.update((map) => {
                  const newMap = new Map(map)
                  newMap.set(chapterId, {
                    url: URL.createObjectURL(blob),
                    blob: blob,
                  })
                  return newMap
                })
              }
            } catch (e) {
              console.warn('Failed to load audio for chapter', chapterId, e)
            }
          }
        })
        .catch((err) => {
          console.warn('Failed to hydrate generation status', err)
        })
    }
  } else {
    chapterStatus.set(new Map())
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    chapterProgress.set(new Map())
    selectedChapters.set(new Map())
  }
})
