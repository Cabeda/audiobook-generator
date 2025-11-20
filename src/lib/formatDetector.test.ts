import { describe, it, expect } from 'vitest'
import { detectFormat } from './formatDetector'

describe('formatDetector', () => {
  describe('EPUB detection', () => {
    it('should detect EPUB from .epub extension', async () => {
      const file = new File([''], 'book.epub', { type: '' })
      expect(await detectFormat(file)).toBe('epub')
    })

    it('should detect EPUB from MIME type', async () => {
      const file = new File([''], 'book', { type: 'application/epub+zip' })
      expect(await detectFormat(file)).toBe('epub')
    })

    it('should handle uppercase EPUB extension', async () => {
      const file = new File([''], 'BOOK.EPUB', { type: '' })
      expect(await detectFormat(file)).toBe('epub')
    })
  })

  describe('PDF detection', () => {
    it('should detect PDF from .pdf extension', async () => {
      const file = new File([''], 'document.pdf', { type: '' })
      expect(await detectFormat(file)).toBe('pdf')
    })

    it('should detect PDF from MIME type', async () => {
      const file = new File([''], 'document', { type: 'application/pdf' })
      expect(await detectFormat(file)).toBe('pdf')
    })

    // Note: PDF magic bytes test skipped in Node environment
    // The arrayBuffer() method is not available on File polyfill
    // PDF detection still works via extension and MIME type
  })

  describe('TXT detection', () => {
    it('should detect TXT from .txt extension', async () => {
      const file = new File(['text content'], 'book.txt', { type: '' })
      expect(await detectFormat(file)).toBe('txt')
    })

    it('should detect TXT from MIME type', async () => {
      const file = new File(['text'], 'book', { type: 'text/plain' })
      expect(await detectFormat(file)).toBe('txt')
    })
  })

  describe('HTML detection', () => {
    it('should detect HTML from .html extension', async () => {
      const file = new File(['<html></html>'], 'page.html', { type: '' })
      expect(await detectFormat(file)).toBe('html')
    })

    it('should detect HTML from .htm extension', async () => {
      const file = new File(['<html></html>'], 'page.htm', { type: '' })
      expect(await detectFormat(file)).toBe('html')
    })

    it('should detect HTML from MIME type', async () => {
      const file = new File(['<html></html>'], 'page', { type: 'text/html' })
      expect(await detectFormat(file)).toBe('html')
    })
  })

  describe('MOBI detection', () => {
    it('should detect MOBI from .mobi extension', async () => {
      const file = new File([''], 'book.mobi', { type: '' })
      expect(await detectFormat(file)).toBe('mobi')
    })

    it('should detect MOBI from MIME type', async () => {
      const file = new File([''], 'book', { type: 'application/x-mobipocket-ebook' })
      expect(await detectFormat(file)).toBe('mobi')
    })
  })

  describe('DOCX detection', () => {
    it('should detect DOCX from .docx extension', async () => {
      const file = new File([''], 'document.docx', { type: '' })
      expect(await detectFormat(file)).toBe('docx')
    })

    it('should detect DOCX from MIME type', async () => {
      const file = new File([''], 'document', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      expect(await detectFormat(file)).toBe('docx')
    })
  })

  describe('Unknown format handling', () => {
    it('should return unknown for unsupported extension', async () => {
      const file = new File([''], 'file.xyz', { type: '' })
      expect(await detectFormat(file)).toBe('unknown')
    })

    it('should return unknown for unsupported MIME type', async () => {
      const file = new File([''], 'file', { type: 'application/octet-stream' })
      expect(await detectFormat(file)).toBe('unknown')
    })

    it('should return unknown for file with no extension', async () => {
      const file = new File([''], 'file', { type: '' })
      expect(await detectFormat(file)).toBe('unknown')
    })
  })

  describe('Edge cases', () => {
    it('should handle files with multiple dots in name', async () => {
      const file = new File([''], 'my.book.file.epub', { type: '' })
      expect(await detectFormat(file)).toBe('epub')
    })

    it('should handle empty filename', async () => {
      const file = new File([''], '', { type: '' })
      expect(await detectFormat(file)).toBe('unknown')
    })

    it('should prioritize MIME type over extension', async () => {
      const file = new File([''], 'book.txt', { type: 'application/epub+zip' })
      expect(await detectFormat(file)).toBe('epub')
    })
  })
})
