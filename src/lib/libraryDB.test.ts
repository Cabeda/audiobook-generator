import { describe, it, expect, beforeEach } from 'vitest'
import {
  addBook,
  getBook,
  getAllBooksMetadata,
  deleteBook,
  updateLastAccessed,
  searchBooks,
  findBookByTitleAuthor,
  clearLibrary,
  saveChapterAudio,
  getChapterAudio,
  getChapterAudioWithSettings,
  deleteBookAudio,
  updateChapterLanguage,
  updateBookLanguage,
  type AudioGenerationSettings,
} from './libraryDB'
import type { Book } from './types/book'
import 'fake-indexeddb/auto'

describe('libraryDB', () => {
  const mockBook: Book = {
    title: 'Test Book',
    author: 'Test Author',
    chapters: [
      { id: '1', title: 'Chapter 1', content: 'Content 1' },
      { id: '2', title: 'Chapter 2', content: 'Content 2' },
    ],
    cover: 'data:image/png;base64,test',
    format: 'epub',
    language: 'en',
  }

  beforeEach(async () => {
    // Clear database before each test
    await clearLibrary()
  })

  it('should add and retrieve a book', async () => {
    const id = await addBook(mockBook)
    expect(id).toBeDefined()

    const retrieved = await getBook(id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe(mockBook.title)
    expect(retrieved?.author).toBe(mockBook.author)
    expect(retrieved?.chapters).toHaveLength(2)
    expect(retrieved?.dateAdded).toBeDefined()
    expect(retrieved?.lastAccessed).toBeDefined()
  })

  it('should get all books metadata without chapters', async () => {
    await addBook(mockBook)
    await addBook({ ...mockBook, title: 'Second Book' })

    const metadata = await getAllBooksMetadata()
    expect(metadata).toHaveLength(2)
    expect(metadata[0].title).toBe('Test Book')
    expect((metadata[0] as any).chapters).toBeUndefined()
    expect(metadata[0].chapterCount).toBe(2)
  })

  it('should delete a book', async () => {
    const id = await addBook(mockBook)
    await deleteBook(id)

    const retrieved = await getBook(id)
    expect(retrieved).toBeNull()
  })

  it('should update last accessed time', async () => {
    const id = await addBook(mockBook)
    const original = await getBook(id)
    const originalTime = original?.lastAccessed || 0

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10))

    await updateLastAccessed(id)
    const updated = await getBook(id)

    expect(updated?.lastAccessed).toBeGreaterThan(originalTime)
  })

  it('should search books by title or author', async () => {
    await addBook(mockBook)
    await addBook({ ...mockBook, title: 'Another Story', author: 'Jane Doe' })

    const byTitle = await searchBooks('Test')
    expect(byTitle).toHaveLength(1)
    expect(byTitle[0].title).toBe('Test Book')

    const byAuthor = await searchBooks('Jane')
    expect(byAuthor).toHaveLength(1)
    expect(byAuthor[0].author).toBe('Jane Doe')

    const noMatch = await searchBooks('Nonexistent')
    expect(noMatch).toHaveLength(0)
  })

  it('should find book by title and author', async () => {
    await addBook(mockBook)

    const found = await findBookByTitleAuthor(mockBook.title, mockBook.author)
    expect(found).toBeDefined()
    expect(found?.title).toBe(mockBook.title)

    const notFound = await findBookByTitleAuthor('Other', 'Author')
    expect(notFound).toBeNull()
  })

  describe('Audio Persistence', () => {
    let bookId: number
    const mockAudioBlob = new Blob(['fake audio data'], { type: 'audio/wav' })
    const mockSettings: AudioGenerationSettings = {
      model: 'kokoro',
      voice: 'af_heart',
      quantization: 'q8',
      device: 'auto',
    }

    beforeEach(async () => {
      bookId = await addBook(mockBook)
    })

    // Note: fake-indexeddb has limitations with Blob serialization.
    // These tests verify the API contract but may not fully test Blob persistence.
    // For complete testing, use E2E tests with real IndexedDB or integration tests.

    it('should save and retrieve chapter audio with settings', async () => {
      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)

      const result = await getChapterAudioWithSettings(bookId, '1')
      expect(result).toBeDefined()
      expect(result?.blob).toBeDefined()
      // Note: fake-indexeddb doesn't preserve Blob fully, so we check structure
      expect(result?.settings).toEqual(mockSettings)
    })

    it('should save chapter audio without settings (backward compatibility)', async () => {
      await saveChapterAudio(bookId, '1', mockAudioBlob)

      const result = await getChapterAudioWithSettings(bookId, '1')
      expect(result).toBeDefined()
      expect(result?.blob).toBeDefined()
      expect(result?.settings).toBeUndefined()
    })

    it('should retrieve chapter audio blob only (backward compatibility)', async () => {
      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)

      const blob = await getChapterAudio(bookId, '1')
      expect(blob).toBeDefined()
    })

    it('should return null for non-existent chapter audio', async () => {
      const result = await getChapterAudioWithSettings(bookId, 'nonexistent')
      expect(result).toBeNull()

      const blob = await getChapterAudio(bookId, 'nonexistent')
      expect(blob).toBeNull()
    })

    it('should save audio for multiple chapters', async () => {
      const blob1 = new Blob(['audio 1'], { type: 'audio/wav' })
      const blob2 = new Blob(['audio 2'], { type: 'audio/wav' })

      await saveChapterAudio(bookId, '1', blob1, mockSettings)
      await saveChapterAudio(bookId, '2', blob2, mockSettings)

      const result1 = await getChapterAudioWithSettings(bookId, '1')
      const result2 = await getChapterAudioWithSettings(bookId, '2')

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()
      expect(result1?.settings).toEqual(mockSettings)
      expect(result2?.settings).toEqual(mockSettings)
    })

    it('should update existing chapter audio', async () => {
      const newBlob = new Blob(['updated audio'], { type: 'audio/wav' })
      const newSettings: AudioGenerationSettings = {
        model: 'piper',
        voice: 'en_US-hfc_female-medium',
      }

      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)
      await saveChapterAudio(bookId, '1', newBlob, newSettings)

      const result = await getChapterAudioWithSettings(bookId, '1')
      expect(result).toBeDefined()
      expect(result?.settings).toEqual(newSettings)
    })

    it('should delete all audio for a book', async () => {
      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)
      await saveChapterAudio(bookId, '2', mockAudioBlob, mockSettings)

      await deleteBookAudio(bookId)

      const result1 = await getChapterAudioWithSettings(bookId, '1')
      const result2 = await getChapterAudioWithSettings(bookId, '2')

      expect(result1).toBeNull()
      expect(result2).toBeNull()
    })

    it('should delete audio when book is deleted', async () => {
      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)

      await deleteBook(bookId)

      const result = await getChapterAudioWithSettings(bookId, '1')
      expect(result).toBeNull()
    })

    it('should isolate audio by book ID', async () => {
      const bookId2 = await addBook({ ...mockBook, title: 'Book 2' })

      await saveChapterAudio(bookId, '1', mockAudioBlob, mockSettings)
      await saveChapterAudio(bookId2, '1', mockAudioBlob, mockSettings)

      const result1 = await getChapterAudioWithSettings(bookId, '1')
      const result2 = await getChapterAudioWithSettings(bookId2, '1')

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()

      await deleteBookAudio(bookId)

      const afterDelete1 = await getChapterAudioWithSettings(bookId, '1')
      const afterDelete2 = await getChapterAudioWithSettings(bookId2, '1')

      expect(afterDelete1).toBeNull()
      expect(afterDelete2).toBeDefined()
    })

    it('should handle different generation settings', async () => {
      const kokoroSettings: AudioGenerationSettings = {
        model: 'kokoro',
        voice: 'af_bella',
        quantization: 'fp16',
        device: 'webgpu',
      }

      const piperSettings: AudioGenerationSettings = {
        model: 'piper',
        voice: 'en_US-lessac-medium',
      }

      await saveChapterAudio(bookId, '1', mockAudioBlob, kokoroSettings)
      await saveChapterAudio(bookId, '2', mockAudioBlob, piperSettings)

      const result1 = await getChapterAudioWithSettings(bookId, '1')
      const result2 = await getChapterAudioWithSettings(bookId, '2')

      expect(result1?.settings?.quantization).toBe('fp16')
      expect(result1?.settings?.device).toBe('webgpu')
      expect(result2?.settings?.quantization).toBeUndefined()
      expect(result2?.settings?.device).toBeUndefined()
    })
  })

  describe('Language updates', () => {
    let bookId: number

    beforeEach(async () => {
      bookId = await addBook(mockBook)
    })

    it('should update chapter language', async () => {
      await updateChapterLanguage(bookId, '1', 'es')

      const book = await getBook(bookId)
      expect(book?.chapters[0].language).toBe('es')
      expect(book?.chapters[1].language).toBeUndefined()
    })

    it('should clear chapter language when set to undefined', async () => {
      await updateChapterLanguage(bookId, '1', 'es')
      await updateChapterLanguage(bookId, '1', undefined)

      const book = await getBook(bookId)
      expect(book?.chapters[0].language).toBeUndefined()
    })

    it('should reject when updating non-existent chapter', async () => {
      await expect(updateChapterLanguage(bookId, 'nonexistent', 'es')).rejects.toThrow(
        'Chapter not found'
      )
    })

    it('should reject when updating chapter in non-existent book', async () => {
      await expect(updateChapterLanguage(99999, '1', 'es')).rejects.toThrow('Book not found')
    })

    it('should update book language', async () => {
      await updateBookLanguage(bookId, 'fr')

      const book = await getBook(bookId)
      expect(book?.language).toBe('fr')
    })

    it('should reject when updating non-existent book language', async () => {
      await expect(updateBookLanguage(99999, 'es')).rejects.toThrow('Book not found')
    })

    it('should persist language updates across multiple operations', async () => {
      await updateBookLanguage(bookId, 'de')
      await updateChapterLanguage(bookId, '1', 'es')
      await updateChapterLanguage(bookId, '2', 'fr')

      const book = await getBook(bookId)
      expect(book?.language).toBe('de')
      expect(book?.chapters[0].language).toBe('es')
      expect(book?.chapters[1].language).toBe('fr')
    })
  })
})
