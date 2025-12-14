import { describe, it, expect } from 'vitest'
import type { Book } from '../types/book'
import { resolveChapterLanguage } from './languageResolver'

describe('Language Integration', () => {
  it('should handle a book with mixed-language chapters', () => {
    const book: Book = {
      title: 'Polyglot Collection',
      author: 'Various',
      language: 'en',
      chapters: [
        { id: 'ch1', title: 'English Chapter', content: 'Hello', language: undefined },
        { id: 'ch2', title: 'Spanish Chapter', content: 'Hola', language: 'es' },
        { id: 'ch3', title: 'French Chapter', content: 'Bonjour', language: 'fr' },
        { id: 'ch4', title: 'Another English', content: 'Hi', language: undefined },
      ],
    }

    // Chapter 1: uses book default (en)
    expect(resolveChapterLanguage(book.chapters[0], book)).toBe('en')

    // Chapter 2: uses override (es)
    expect(resolveChapterLanguage(book.chapters[1], book)).toBe('es')

    // Chapter 3: uses override (fr)
    expect(resolveChapterLanguage(book.chapters[2], book)).toBe('fr')

    // Chapter 4: uses book default (en)
    expect(resolveChapterLanguage(book.chapters[3], book)).toBe('en')
  })

  it('should handle changing book language and overrides', () => {
    const book: Book = {
      title: 'Test Book',
      author: 'Test',
      language: 'en',
      chapters: [
        { id: 'ch1', title: 'Chapter 1', content: 'Content 1', language: undefined },
        { id: 'ch2', title: 'Chapter 2', content: 'Content 2', language: 'fr' },
      ],
    }

    // Initial state
    expect(resolveChapterLanguage(book.chapters[0], book)).toBe('en')
    expect(resolveChapterLanguage(book.chapters[1], book)).toBe('fr')

    // Change book language to Spanish
    book.language = 'es'

    // Chapter 1 now resolves to Spanish (follows book default)
    expect(resolveChapterLanguage(book.chapters[0], book)).toBe('es')

    // Chapter 2 still uses its override
    expect(resolveChapterLanguage(book.chapters[1], book)).toBe('fr')

    // Remove chapter 2's override
    book.chapters[1].language = undefined

    // Now chapter 2 also uses book default
    expect(resolveChapterLanguage(book.chapters[1], book)).toBe('es')
  })

  it('should support typical audiobook scenario', () => {
    // English audiobook with one Spanish preface
    const book: Book = {
      title: 'Bilingual Novel',
      author: 'Author Name',
      language: 'en', // Book is primarily English
      chapters: [
        { id: 'preface', title: 'Prólogo', content: 'Spanish preface', language: 'es' },
        { id: 'ch1', title: 'Chapter 1', content: 'English content' },
        { id: 'ch2', title: 'Chapter 2', content: 'English content' },
        { id: 'ch3', title: 'Chapter 3', content: 'English content' },
      ],
    }

    expect(resolveChapterLanguage(book.chapters[0], book)).toBe('es') // Spanish preface
    expect(resolveChapterLanguage(book.chapters[1], book)).toBe('en') // English chapters
    expect(resolveChapterLanguage(book.chapters[2], book)).toBe('en')
    expect(resolveChapterLanguage(book.chapters[3], book)).toBe('en')
  })
})
