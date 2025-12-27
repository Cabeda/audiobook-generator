import { describe, it, expect } from 'vitest'
import type { Book } from '../types/book'
import { resolveChapterLanguage, resolveChapterLanguageWithDetection } from './languageResolver'
import { detectChapterLanguage } from './languageDetector'

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

describe('Language Detection Integration', () => {
  it('should detect language for English content', () => {
    const result = detectChapterLanguage(
      'This is an English text sample. The quick brown fox jumps over the lazy dog.'
    )
    expect(result.languageCode).toBe('en')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('should detect language for Spanish content', () => {
    const result = detectChapterLanguage(
      'Este es un texto de ejemplo en español. El rápido zorro marrón salta sobre el perro perezoso.'
    )
    expect(result.languageCode).toBe('es')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('should use detected language with high confidence in resolution', () => {
    const book: Book = {
      title: 'Test Book',
      author: 'Test',
      language: 'en',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter 1',
          content: 'Content',
          detectedLanguage: 'es',
          languageConfidence: 0.9,
        },
      ],
    }

    // Should use detected language since confidence is high
    expect(resolveChapterLanguageWithDetection(book.chapters[0], book)).toBe('es')
  })

  it('should ignore low-confidence detection and fallback to book language', () => {
    const book: Book = {
      title: 'Test Book',
      author: 'Test',
      language: 'en',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter 1',
          content: 'Content',
          detectedLanguage: 'es',
          languageConfidence: 0.3, // Low confidence
        },
      ],
    }

    // Should fallback to book language
    expect(resolveChapterLanguageWithDetection(book.chapters[0], book)).toBe('en')
  })

  it('should prioritize manual override over detection', () => {
    const book: Book = {
      title: 'Test Book',
      author: 'Test',
      language: 'en',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter 1',
          content: 'Content',
          language: 'fr', // Manual override
          detectedLanguage: 'es',
          languageConfidence: 0.9,
        },
      ],
    }

    // Manual override takes precedence
    expect(resolveChapterLanguageWithDetection(book.chapters[0], book)).toBe('fr')
  })

  it('should handle mixed-language book with auto-detection', () => {
    const book: Book = {
      title: 'Polyglot Book',
      author: 'Various',
      language: 'en',
      chapters: [
        {
          id: 'ch1',
          title: 'English Chapter',
          content: 'Hello',
          detectedLanguage: 'en',
          languageConfidence: 0.8,
        },
        {
          id: 'ch2',
          title: 'Spanish Chapter',
          content: 'Hola',
          detectedLanguage: 'es',
          languageConfidence: 0.85,
        },
        {
          id: 'ch3',
          title: 'Manual French',
          content: 'Bonjour',
          language: 'fr', // Manual override
          detectedLanguage: 'en',
          languageConfidence: 0.6,
        },
        {
          id: 'ch4',
          title: 'Low confidence',
          content: 'Short',
          detectedLanguage: 'es',
          languageConfidence: 0.2, // Too low to trust
        },
      ],
    }

    // Chapter 1: uses detected language (en)
    expect(resolveChapterLanguageWithDetection(book.chapters[0], book)).toBe('en')

    // Chapter 2: uses detected language (es)
    expect(resolveChapterLanguageWithDetection(book.chapters[1], book)).toBe('es')

    // Chapter 3: manual override takes precedence
    expect(resolveChapterLanguageWithDetection(book.chapters[2], book)).toBe('fr')

    // Chapter 4: low confidence, falls back to book default (en)
    expect(resolveChapterLanguageWithDetection(book.chapters[3], book)).toBe('en')
  })

  it('should handle chapters with no detection data', () => {
    const book: Book = {
      title: 'Test Book',
      author: 'Test',
      language: 'en',
      chapters: [
        {
          id: 'ch1',
          title: 'Chapter 1',
          content: 'Content',
          // No detection data
        },
      ],
    }

    // Should fallback to book language
    expect(resolveChapterLanguageWithDetection(book.chapters[0], book)).toBe('en')
  })
})
