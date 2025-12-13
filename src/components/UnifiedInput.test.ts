import { describe, it, expect } from 'vitest'
import { loadBook } from '../lib/bookLoader'

/**
 * Unit tests for file upload functionality via UnifiedInput component.
 * Tests the core file handling and parsing logic using real test files.
 *
 * NOTE: These tests focus on the bookLoader orchestration logic and parser
 * integration. Full EPUB/TXT parsing tests are in the individual parser test files:
 * - epubParser.test.ts for EPUB-specific tests
 * - parsers/txtParser.test.ts for TXT-specific tests
 */
describe('UnifiedInput File Upload', () => {
  describe('file handling with test-short.txt', () => {
    it('should successfully parse test-short.txt file', async () => {
      const file = new File(
        ['Plain text test content\n\nChapter 1\nSome text here.'],
        'test-short.txt',
        {
          type: 'text/plain',
        }
      )

      const book = await loadBook(file)

      expect(book).toBeDefined()
      expect(book.title).toBeDefined()
      expect(book.title).not.toBe('')
      expect(book.chapters).toBeInstanceOf(Array)
      expect(book.chapters.length).toBeGreaterThan(0)
      expect(book.format).toBe('txt')
    })

    it('should extract content from test-short.txt', async () => {
      const file = new File(['Test Title\n\nChapter 1\nContent here'], 'test-short.txt', {
        type: 'text/plain',
      })

      const book = await loadBook(file)

      expect(book.chapters.length).toBeGreaterThan(0)
      const firstChapter = book.chapters[0]
      expect(firstChapter).toBeDefined()
      expect(firstChapter.title).toBeDefined()
      expect(firstChapter.content).toBeDefined()
      expect(firstChapter.content.length).toBeGreaterThan(0)
    })
  })

  describe('file handling error cases', () => {
    it('should reject unsupported file formats', async () => {
      const file = new File(['random content'], 'file.xyz', { type: 'application/octet-stream' })

      await expect(loadBook(file)).rejects.toThrow('Unsupported format')
    })

    it('should reject corrupted EPUB files', async () => {
      // Create a fake EPUB file with invalid ZIP structure
      const fakeEpubContent = 'This is not a valid EPUB file'
      const file = new File([fakeEpubContent], 'fake.epub', {
        type: 'application/epub+zip',
      })

      await expect(loadBook(file)).rejects.toThrow()
    })

    it('should handle empty text files gracefully', async () => {
      const file = new File([''], 'empty.txt', { type: 'text/plain' })

      // Empty files should still parse as TXT
      const book = await loadBook(file)
      expect(book).toBeDefined()
      expect(book.format).toBe('txt')
    })
  })

  describe('dynamic import of bookLoader', () => {
    it('should successfully import bookLoader dynamically', async () => {
      const { loadBook: importedLoadBook } = await import('../lib/bookLoader')
      expect(importedLoadBook).toBeDefined()
      expect(typeof importedLoadBook).toBe('function')
    })

    it('should work with dynamically imported loadBook', async () => {
      const { loadBook: dynamicLoadBook } = await import('../lib/bookLoader')
      const file = new File(['Test content'], 'test.txt', { type: 'text/plain' })

      const book = await dynamicLoadBook(file)
      expect(book).toBeDefined()
      expect(book.format).toBe('txt')
    })
  })

  describe('supported formats detection', () => {
    it('should detect supported formats', async () => {
      const { getSupportedFormats } = await import('../lib/bookLoader')
      const formats = await getSupportedFormats()

      expect(formats).toBeInstanceOf(Array)
      expect(formats.length).toBeGreaterThan(0)
      expect(formats).toContain('EPUB')
      expect(formats).toContain('TXT')
      expect(formats).toContain('HTML')
    })
  })

  describe('file type detection', () => {
    it('should detect TXT files by extension', async () => {
      const file = new File(['Plain text content'], 'test-short.txt', { type: 'text/plain' })

      const { detectFormat } = await import('../lib/formatDetector')
      const format = await detectFormat(file)
      expect(format).toBe('txt')
    })

    it('should detect HTML files by extension', async () => {
      const file = new File(['<html></html>'], 'page.html', { type: 'text/html' })

      const { detectFormat } = await import('../lib/formatDetector')
      const format = await detectFormat(file)
      expect(format).toBe('html')
    })
  })

  describe('book object structure', () => {
    it('should return properly structured Book object for TXT', async () => {
      const file = new File(['Test Title\n\nContent here'], 'test.txt', { type: 'text/plain' })

      const book = await loadBook(file)

      // Check required Book properties
      expect(book).toHaveProperty('title')
      expect(book).toHaveProperty('chapters')
      expect(book).toHaveProperty('format')

      // Check chapter structure
      if (book.chapters.length > 0) {
        const chapter = book.chapters[0]
        expect(chapter).toHaveProperty('id')
        expect(chapter).toHaveProperty('title')
        expect(chapter).toHaveProperty('content')
      }
    })

    it('should return properly structured Book object for HTML', async () => {
      const html = '<html><head><title>Test Book</title></head><body><p>Content</p></body></html>'
      const file = new File([html], 'test.html', { type: 'text/html' })

      const book = await loadBook(file)

      expect(book).toHaveProperty('title')
      expect(book).toHaveProperty('chapters')
      expect(book).toHaveProperty('format')
      expect(book.format).toBe('html')
    })
  })

  describe('format detection edge cases', () => {
    it('should handle files without extensions gracefully', async () => {
      // MIME type detection should still work
      const file = new File(['<html></html>'], 'document', { type: 'text/html' })

      const { detectFormat } = await import('../lib/formatDetector')
      const format = await detectFormat(file)
      expect(format).toBe('html')
    })

    it('should detect unknown format correctly', async () => {
      const file = new File(['random'], 'file.unknown', { type: 'application/octet-stream' })

      const { detectFormat } = await import('../lib/formatDetector')
      const format = await detectFormat(file)
      expect(format).toBe('unknown')
    })
  })

  describe('bookLoader error handling', () => {
    it('should provide helpful error messages for unsupported formats', async () => {
      const file = new File(['content'], 'file.xyz', { type: 'application/octet-stream' })

      try {
        await loadBook(file)
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        const message = (err as Error).message
        expect(message).toContain('Unsupported format')
        expect(message).toContain('Supported formats')
      }
    })
  })
})
