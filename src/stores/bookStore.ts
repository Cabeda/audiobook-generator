import { writable, derived, type Writable } from 'svelte/store'
import type { Book } from '../lib/types/book'

// Book state store
export const book: Writable<Book | null> = writable(null)

// Chapter selection state (Map of chapter id -> boolean)
export const selectedChapters = writable(new Map<string, boolean>())

// Generated audio state (Map of chapter id -> {url, blob})
export const generatedAudio = writable(new Map<string, { url: string; blob: Blob }>())

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
