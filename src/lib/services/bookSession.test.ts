// Specification for the book lifecycle the revamp UI drives: importing,
// opening, removing, and per-chapter overrides that survive a reload.
// Seam: bookSession (UI → libraryDB/bookLoader).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryBook } from '../libraryDB'

vi.mock('../libraryDB', () => ({
  addBook: vi.fn(async () => 42),
  getBook: vi.fn(async () => null),
  deleteBook: vi.fn(async () => undefined),
  updateLastAccessed: vi.fn(async () => undefined),
  updateChapterModel: vi.fn(async () => undefined),
  updateChapterVoice: vi.fn(async () => undefined),
  updateChapterLanguage: vi.fn(async () => undefined),
}))

vi.mock('../bookLoader', () => ({
  loadBook: vi.fn(async () => null),
}))

vi.mock('./languageDetectionService', () => ({
  detectAndPersistLanguagesForBook: vi.fn(async () => undefined),
}))

const db = await import('../libraryDB')
const loader = await import('../bookLoader')
const detection = await import('./languageDetectionService')
const { importBook, openBook, removeBook, setChapterOverride } = await import('./bookSession')

function parsedBook() {
  return {
    title: 'The Quiet Mill',
    author: 'Demo Author',
    chapters: [{ id: 'c1', title: 'I', content: '<p>hi</p>' }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importBook', () => {
  it('parses a file, stores it and hands back the stored book', async () => {
    const file = new File(['x'], 'book.epub')
    vi.mocked(loader.loadBook).mockResolvedValue(parsedBook() as never)
    vi.mocked(db.getBook).mockResolvedValue({ id: 42, ...parsedBook() } as unknown as LibraryBook)

    const book = await importBook({ file })

    expect(loader.loadBook).toHaveBeenCalledWith(file)
    expect(db.addBook).toHaveBeenCalled()
    expect(detection.detectAndPersistLanguagesForBook).toHaveBeenCalled()
    expect(book.id).toBe(42)
  })

  it('fetches a URL, then stores what it got', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'application/epub+zip' },
        blob: async () => new Blob(['x']),
      }))
    )
    vi.mocked(loader.loadBook).mockResolvedValue(parsedBook() as never)
    vi.mocked(db.getBook).mockResolvedValue({ id: 42, ...parsedBook() } as unknown as LibraryBook)

    await importBook({ url: 'https://example.test/books/quiet.epub' })

    const loaded = vi.mocked(loader.loadBook).mock.calls[0][0]
    expect(loaded.name).toBe('quiet.epub')
    expect(db.addBook).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('openBook', () => {
  it('loads the book and marks it as read now', async () => {
    vi.mocked(db.getBook).mockResolvedValue({ id: 42, ...parsedBook() } as unknown as LibraryBook)

    const book = await openBook(42)

    expect(book?.id).toBe(42)
    expect(db.updateLastAccessed).toHaveBeenCalledWith(42)
  })
})

describe('removeBook', () => {
  it('deletes the book from the library', async () => {
    await removeBook(42)
    expect(db.deleteBook).toHaveBeenCalledWith(42)
  })
})

describe('setChapterOverride', () => {
  function bookWithChapter(): LibraryBook {
    return {
      id: 42,
      ...parsedBook(),
      dateAdded: 1,
      lastAccessed: 1,
    } as unknown as LibraryBook
  }

  it('persists each override through its own store', async () => {
    const book = bookWithChapter()

    await setChapterOverride(book, 'c1', {
      model: 'kitten',
      voice: 'Bella',
      language: 'pt',
    })

    expect(db.updateChapterModel).toHaveBeenCalledWith(42, 'c1', 'kitten')
    expect(db.updateChapterVoice).toHaveBeenCalledWith(42, 'c1', 'Bella')
    expect(db.updateChapterLanguage).toHaveBeenCalledWith(42, 'c1', 'pt')
  })

  it('updates the book in hand so the reader sees the change at once', async () => {
    const book = bookWithChapter()

    await setChapterOverride(book, 'c1', { voice: 'Luna' })

    expect(book.chapters[0].voice).toBe('Luna')
    expect(db.updateChapterModel).not.toHaveBeenCalled()
  })
})
