import { describe, it, expect, beforeAll } from 'vitest'
import { parseEpubFile, type Chapter } from './epubParser.ts'
// Note: avoid static import of Node `fs` in test file to prevent Vite import-analysis
import { resolve } from 'path'

describe('EPUB Parser', () => {
  let robinsonCrusoeFile: File

  beforeAll(async () => {
    // Load the Robinson Crusoe EPUB from the example folder
    const epubPath = resolve(
      __dirname,
      '../../example/The_Life_and_Adventures_of_Robinson_Crusoe.epub'
    )
    // Use dynamic import to access fs at runtime (prevents bundler from resolving `fs`)
    const fs = await import('fs')
    const buffer = fs.readFileSync(epubPath)
    const blob = new Blob([buffer], { type: 'application/epub+zip' })
    robinsonCrusoeFile = new File([blob], 'The_Life_and_Adventures_of_Robinson_Crusoe.epub', {
      type: 'application/epub+zip',
    })

    // Polyfill arrayBuffer method for File in test environment
    if (!robinsonCrusoeFile.arrayBuffer) {
      Object.defineProperty(robinsonCrusoeFile, 'arrayBuffer', {
        value: () => {
          // Return the actual ArrayBuffer from the Node.js Buffer
          const ab = new ArrayBuffer(buffer.length)
          const view = new Uint8Array(ab)
          for (let i = 0; i < buffer.length; i++) {
            view[i] = buffer[i]
          }
          return Promise.resolve(ab)
        },
      })
    }

    // Polyfill URL.createObjectURL for test environment
    if (!URL.createObjectURL) {
      URL.createObjectURL = () => 'blob:mock-url'
    }
  })

  describe('parseEpubFile', () => {
    it('should successfully parse Robinson Crusoe EPUB', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      expect(book).toBeDefined()
      expect(book.title).toBeDefined()
      expect(book.author).toBeDefined()
      expect(book.chapters).toBeDefined()
      expect(Array.isArray(book.chapters)).toBe(true)
    })

    it('should extract correct metadata from Robinson Crusoe', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      // Robinson Crusoe should have title and author
      expect(book.title).toBeTruthy()
      expect(book.title).not.toBe('Unknown')
      expect(book.author).toBeTruthy()
      expect(book.author).not.toBe('Unknown')

      // Log the extracted values for verification
      console.log('Title:', book.title)
      console.log('Author:', book.author)
    })

    it('should extract chapters from Robinson Crusoe', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      expect(book.chapters.length).toBeGreaterThan(0)

      // Each chapter should have required properties
      book.chapters.forEach((chapter: Chapter) => {
        expect(chapter).toHaveProperty('id')
        expect(chapter).toHaveProperty('title')
        expect(chapter).toHaveProperty('content')
        expect(chapter.id).toBeTruthy()
        expect(chapter.title).toBeTruthy()
        expect(chapter.content).toBeTruthy()
      })

      console.log(`Found ${book.chapters.length} chapters`)
      console.log('First chapter title:', book.chapters[0]?.title)
    })

    it('should extract clean HTML content from chapters', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      // Find a chapter with actual content (skip cover)
      const chapterWithContent = book.chapters.find((ch) => {
        const textContent = ch.content.replace(/<[^>]*>/g, '').trim()
        return textContent.length > 100
      })
      expect(chapterWithContent).toBeDefined()

      // Content should be HTML (structure preserved for segment-based highlighting)
      expect(chapterWithContent!.content).toMatch(/<[^>]+>/)

      // But should not contain dangerous tags (script, style, etc.)
      expect(chapterWithContent!.content).not.toMatch(/<script/i)
      expect(chapterWithContent!.content).not.toMatch(/<style/i)
      expect(chapterWithContent!.content).not.toMatch(/<iframe/i)

      // Should not have inline styles or classes (sanitized)
      expect(chapterWithContent!.content).not.toMatch(/style=/i)
      expect(chapterWithContent!.content).not.toMatch(/class=/i)

      // Content should contain actual text when HTML is stripped
      const textContent = chapterWithContent!.content.replace(/<[^>]*>/g, '').trim()
      expect(textContent.length).toBeGreaterThan(100)

      console.log('Chapter content length:', chapterWithContent!.content.length)
      console.log('Text content length:', textContent.length)
      console.log('First 200 chars of HTML:', chapterWithContent!.content.substring(0, 200))
    })

    it('should handle cover image if present', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      if (book.cover) {
        // If cover exists, it should be a blob URL
        expect(book.cover).toMatch(/^blob:/)
        console.log('Cover URL:', book.cover)
      } else {
        console.log('No cover image found in this EPUB')
      }
    })

    it('should extract meaningful chapter titles', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      const titledChapters = book.chapters.filter(
        (ch: Chapter) => ch.title !== 'Unknown' && ch.title !== ch.id && ch.title.length > 0
      )

      // At least some chapters should have meaningful titles
      expect(titledChapters.length).toBeGreaterThan(0)

      console.log('Sample chapter titles:')
      titledChapters.slice(0, 5).forEach((ch: Chapter) => {
        console.log(`  - ${ch.title}`)
      })
    })

    it('should handle chapters in correct spine order', async () => {
      const book = await parseEpubFile(robinsonCrusoeFile)

      // Chapters should be in the order defined by the spine
      expect(book.chapters.length).toBeGreaterThan(1)

      // Each chapter should have a unique ID
      const ids = book.chapters.map((ch: Chapter) => ch.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('should throw error for invalid EPUB', async () => {
      const invalidFile = new File(['invalid content'], 'invalid.epub', {
        type: 'application/epub+zip',
      })

      await expect(parseEpubFile(invalidFile)).rejects.toThrow()
    })
  })

  describe('parseEpubFile with SHORT EPUB fixture', () => {
    let shortFile: File

    beforeAll(async () => {
      const epubPath = resolve(__dirname, '../../books/test-short.epub')
      const fs = await import('fs')
      const buffer = fs.readFileSync(epubPath)
      const blob = new Blob([buffer], { type: 'application/epub+zip' })
      shortFile = new File([blob], 'test-short.epub', { type: 'application/epub+zip' })

      // Polyfill arrayBuffer method for File in test environment
      if (!shortFile.arrayBuffer) {
        Object.defineProperty(shortFile, 'arrayBuffer', {
          value: () => {
            const ab = new ArrayBuffer(buffer.length)
            const view = new Uint8Array(ab)
            for (let i = 0; i < buffer.length; i++) view[i] = buffer[i]
            return Promise.resolve(ab)
          },
        })
      }
    })

    it('should parse the short EPUB and extract expected metadata', async () => {
      const book = await parseEpubFile(shortFile)
      expect(book).toBeDefined()
      expect(book.title).toBe('Short Test Book')
      expect(book.author).toBe('Test Author')
      // pandoc sometimes includes extra title/cover pages in the spine; assert at least 3 chapters
      expect(book.chapters.length).toBeGreaterThanOrEqual(3)
    })

    it('should extract chapter content and titles from short EPUB', async () => {
      const book = await parseEpubFile(shortFile)
      const titles = book.chapters.map((c) => c.title)
      // At least one of the chapter titles should include Chapter 1, Chapter 2, Chapter 3 respectively
      expect(titles.some((t) => /Chapter 1/i.test(t))).toBe(true)
      expect(titles.some((t) => /Chapter 2/i.test(t))).toBe(true)
      expect(titles.some((t) => /Chapter 3/i.test(t))).toBe(true)
      // content lengths should be small but non-zero
      expect(book.chapters.every((c) => c.content.length > 0)).toBe(true)
    })
  })
})
