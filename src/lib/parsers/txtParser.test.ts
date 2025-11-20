import { describe, it, expect } from 'vitest'
import { txtParser } from './txtParser'

describe('TxtParser', () => {
  describe('canParse', () => {
    it('should accept .txt files', async () => {
      const file = new File(['content'], 'book.txt', { type: '' })
      expect(await txtParser.canParse(file)).toBe(true)
    })

    it('should accept text/plain MIME type', async () => {
      const file = new File(['content'], 'book', { type: 'text/plain' })
      expect(await txtParser.canParse(file)).toBe(true)
    })

    it('should reject non-txt files', async () => {
      const file = new File(['content'], 'book.pdf', { type: '' })
      expect(await txtParser.canParse(file)).toBe(false)
    })
  })

  describe('getFormatName', () => {
    it('should return TXT', () => {
      expect(txtParser.getFormatName()).toBe('TXT')
    })
  })

  describe('parse', () => {
    it('should extract title and author from first lines', async () => {
      const content = `The Great Book
by John Doe

This is the content of the book.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.title).toBe('The Great Book')
      expect(book.author).toBe('John Doe')
      expect(book.format).toBe('txt')
    })

    it('should handle "Author:" prefix', async () => {
      const content = `My Story
Author: Jane Smith

Content here.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.title).toBe('My Story')
      expect(book.author).toBe('Jane Smith')
    })

    it('should detect chapters with "Chapter" headings', async () => {
      const content = `Test Book
by Author

Chapter 1

This is chapter one content.

Chapter 2

This is chapter two content.

Chapter 3

This is chapter three content.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.chapters.length).toBeGreaterThanOrEqual(2)
      expect(book.chapters[0].title).toContain('Chapter 1')
      expect(book.chapters[0].content).toContain('chapter one')
    })

    it('should detect chapters with numbered sections', async () => {
      const content = `My Book

1. First Section

First section content here.

2. Second Section

Second section content here.

3. Third Section

Third section content here.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.chapters.length).toBeGreaterThanOrEqual(2)
      expect(book.chapters[0].title).toBe('First Section')
      expect(book.chapters[1].title).toBe('Second Section')
    })

    it('should fall back to blank line separators', async () => {
      const content = `Title
by Author

First section with some content that goes on for a while.
More content in the first section.


Second section separated by blank lines.
This section also has content.


Third section here as well.
With more text.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.chapters.length).toBeGreaterThan(0)
      expect(book.format).toBe('txt')
    })

    it('should create single chapter if no clear structure', async () => {
      const content = `Just a simple text file with no clear chapter structure.
All the content is here in one place.`

      const file = new File([content], 'book.txt', { type: 'text/plain' })
      const book = await txtParser.parse(file)

      expect(book.chapters.length).toBe(1)
      expect(book.chapters[0].id).toBe('full-text')
      expect(book.chapters[0].content).toContain('All the content is here')
    })
  })
})
