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
      getBookGenerationStatus(libBook.id).then((generatedIds) => {
        chapterStatus.update((map) => {
          generatedIds.forEach((id) => map.set(id, 'done'))
          return map
        })
        // Also need to update generatedAudio map?
        // Actually, generatedAudio contains Blobs. We don't want to load them all.
        // But UI might depend on 'generatedAudio.has(id)' for some buttons (like Play locally).
        // The new TextReader uses audioService which loads from DB.
        // The GeneratePanel uses generatedAudio to enable "Download" or "Play".
        // If we don't populate generatedAudio, "Play" button in ChapterItem might not appear or work?
        // ChapterItem checks `audioData={audioMap.get(chapter.id)}`.
        // So for purely visual "Done" status, chapterStatus is enough.
        // For playback, we might need a way to say "it's available".
        // However, loading ALL blobs is heavy.
        // Ideally, ChapterItem should knowing it CAN play if status is done, and verify with audioService.
        // But ChapterItem uses <audio src=blob>.
        // We should arguably NOT load all audio blobs.
        // Let's stick to chapterStatus for now, effectively enabling "Read" in TextReader, which loads segments on demand.
        // For "Play" in list view (ChapterItem), it expects a Blob URL.
        // If we want that to work without re-generating, we'd need to fetch audio.
        // But we have segments now, not a single mp3/wav blob per chapter (unless we concat).
        // So ChapterItem's local player might be legacy or need update.
        // TextReader is the primary experience now.
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
