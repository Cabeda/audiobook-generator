import { writable, derived, type Writable } from 'svelte/store'
import type { Book } from '../lib/types/book'

// Book state store
export const book: Writable<Book | null> = writable(null)

// Reset derived stores when book changes

// Chapter selection state (Map of chapter id -> boolean)
export const selectedChapters = writable(new Map<string, boolean>())

// Generated audio state (Map of chapter id -> {url, blob})
export const generatedAudio = writable(new Map<string, { url: string; blob: Blob }>())

// Chapter status tracking
export type ChapterStatus = 'pending' | 'processing' | 'done' | 'error'
export const chapterStatus = writable(new Map<string, ChapterStatus>())
export const chapterErrors = writable(new Map<string, string>())

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
book.subscribe((b) => {
  if (b) {
    // Initialize status for new book
    const statusMap = new Map<string, ChapterStatus>()
    b.chapters.forEach((ch) => statusMap.set(ch.id, 'pending'))
    chapterStatus.set(statusMap)

    // Clear other maps
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    selectedChapters.set(new Map(b.chapters.map((c) => [c.id, true])))
  } else {
    chapterStatus.set(new Map())
    generatedAudio.set(new Map())
    chapterErrors.set(new Map())
    selectedChapters.set(new Map())
  }
})
