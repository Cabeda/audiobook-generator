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
})
