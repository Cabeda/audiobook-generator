import { describe, it, expect } from 'vitest'
import {
  resolveChapterLanguage,
  resolveChapterLanguageWithDetection,
  hasLanguageOverride,
  getLanguageLabel,
  LANGUAGE_OPTIONS,
  DEFAULT_LANGUAGE,
  DETECTION_CONFIDENCE_THRESHOLD,
} from './languageResolver'
import type { Book, Chapter } from '../types/book'

describe('languageResolver', () => {
  describe('resolveChapterLanguage', () => {
    it('should return chapter language when set', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        language: 'es',
      }

      expect(resolveChapterLanguage(chapter, book)).toBe('es')
    })

    it('should fall back to book language when chapter language not set', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'fr',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
      }

      expect(resolveChapterLanguage(chapter, book)).toBe('fr')
    })

    it('should fall back to DEFAULT_LANGUAGE when neither book nor chapter language is set', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
      }

      expect(resolveChapterLanguage(chapter, book)).toBe(DEFAULT_LANGUAGE)
    })

    it('should handle empty string as undefined', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: '',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        language: '',
      }

      // Empty strings are falsy, so should fall back to DEFAULT_LANGUAGE
      expect(resolveChapterLanguage(chapter, book)).toBe(DEFAULT_LANGUAGE)
    })
  })

  describe('hasLanguageOverride', () => {
    it('should return true when chapter has different language than book', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        language: 'es',
      }

      expect(hasLanguageOverride(chapter, book)).toBe(true)
    })

    it('should return false when chapter has same language as book', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        language: 'en',
      }

      expect(hasLanguageOverride(chapter, book)).toBe(false)
    })

    it('should return false when chapter has no language set', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
      }

      expect(hasLanguageOverride(chapter, book)).toBe(false)
    })
  })

  describe('getLanguageLabel', () => {
    it('should return formatted label for known language', () => {
      expect(getLanguageLabel('en')).toBe('🇬🇧 English')
      expect(getLanguageLabel('es')).toBe('🇪🇸 Spanish')
      expect(getLanguageLabel('fr')).toBe('🇫🇷 French')
    })

    it('should return uppercase code for unknown language', () => {
      expect(getLanguageLabel('xyz')).toBe('XYZ')
    })
  })

  describe('LANGUAGE_OPTIONS', () => {
    it('should have at least 10 language options', () => {
      expect(LANGUAGE_OPTIONS.length).toBeGreaterThanOrEqual(10)
    })

    it('should have unique codes', () => {
      const codes = LANGUAGE_OPTIONS.map((opt) => opt.code)
      const uniqueCodes = new Set(codes)
      expect(uniqueCodes.size).toBe(codes.length)
    })

    it('should have code, label, and flag for each option', () => {
      LANGUAGE_OPTIONS.forEach((opt) => {
        expect(opt.code).toBeTruthy()
        expect(opt.label).toBeTruthy()
        expect(opt.flag).toBeTruthy()
        expect(typeof opt.code).toBe('string')
        expect(typeof opt.label).toBe('string')
        expect(typeof opt.flag).toBe('string')
      })
    })
  })

  describe('resolveChapterLanguageWithDetection', () => {
    it('should use chapter language override when set', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        language: 'fr',
        detectedLanguage: 'es',
        languageConfidence: 0.9,
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('fr')
    })

    it('should use detected language when no override and confidence is high', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        detectedLanguage: 'es',
        languageConfidence: 0.9,
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('es')
    })

    it('should fall back to book language when detected confidence is too low', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        detectedLanguage: 'es',
        languageConfidence: DETECTION_CONFIDENCE_THRESHOLD - 0.1,
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('en')
    })

    it('should fall back to book language when detected language is undetermined', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        detectedLanguage: 'und',
        languageConfidence: 0.9,
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('en')
    })

    it('should fall back to DEFAULT_LANGUAGE when no language is set anywhere', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe(DEFAULT_LANGUAGE)
    })

    it('should use detected language at threshold confidence', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        detectedLanguage: 'es',
        languageConfidence: DETECTION_CONFIDENCE_THRESHOLD,
      }

      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('es')
    })

    it('should handle missing confidence value gracefully', () => {
      const book: Book = {
        title: 'Test Book',
        author: 'Test Author',
        chapters: [],
        language: 'en',
      }
      const chapter: Chapter = {
        id: 'ch1',
        title: 'Chapter 1',
        content: 'Content',
        detectedLanguage: 'es',
      }

      // Should fall back to book language when confidence is undefined
      expect(resolveChapterLanguageWithDetection(chapter, book)).toBe('en')
    })
  })
})
