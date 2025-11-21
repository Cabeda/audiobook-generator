import { describe, it, expect } from 'vitest'
import { htmlParser } from './htmlParser'

describe('HtmlParser', () => {
  describe('canParse', () => {
    it('should accept .html files', async () => {
      const file = new File(['<html></html>'], 'book.html', { type: '' })
      expect(await htmlParser.canParse(file)).toBe(true)
    })

    it('should accept .htm files', async () => {
      const file = new File(['<html></html>'], 'book.htm', { type: '' })
      expect(await htmlParser.canParse(file)).toBe(true)
    })

    it('should accept text/html MIME type', async () => {
      const file = new File(['<html></html>'], 'book', { type: 'text/html' })
      expect(await htmlParser.canParse(file)).toBe(true)
    })

    it('should reject non-HTML files', async () => {
      const file = new File(['content'], 'book.txt', { type: '' })
      expect(await htmlParser.canParse(file)).toBe(false)
    })
  })

  describe('getFormatName', () => {
    it('should return HTML', () => {
      expect(htmlParser.getFormatName()).toBe('HTML')
    })
  })

  describe('parse', () => {
    it('should extract title from <title> tag', async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>My Book Title</title>
</head>
<body>
  <p>Content here.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.title).toBe('My Book Title')
      expect(book.format).toBe('html')
    })

    it('should extract author from meta tag', async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Book Title</title>
  <meta name="author" content="John Doe" />
</head>
<body>
  <p>Content.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.author).toBe('John Doe')
    })

    it('should detect chapters from h1 tags', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Book</title></head>
<body>
  <h1>Chapter One</h1>
  <p>This is the first chapter content.</p>
  
  <h1>Chapter Two</h1>
  <p>This is the second chapter content.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.chapters.length).toBeGreaterThanOrEqual(1)
      expect(book.chapters[0].title).toBe('Chapter One')
      expect(book.chapters[0].content).toContain('first chapter')
    })

    it('should detect chapters from h2 tags if no h1', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Book</title></head>
<body>
  <h2>First Section</h2>
  <p>First section content.</p>
  
  <h2>Second Section</h2>
  <p>Second section content.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.chapters.length).toBeGreaterThanOrEqual(1)
      expect(book.chapters[0].title).toBe('First Section')
    })

    it('should create single chapter if no headings', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Simple Doc</title></head>
<body>
  <p>Just a simple document with no headings.</p>
  <p>All content in one place.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.chapters.length).toBe(1)
      expect(book.chapters[0].content).toContain('simple document')
    })

    it('should clean HTML and extract plain text', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Chapter</h1>
  <p>This is <strong>bold</strong> and <em>italic</em> text.</p>
  <p>Another paragraph with <a href="#">a link</a>.</p>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      // HTML tags should be stripped, only text content remains
      expect(book.chapters[0].content).toContain('bold')
      expect(book.chapters[0].content).toContain('italic')
      expect(book.chapters[0].content).not.toContain('<strong>')
      expect(book.chapters[0].content).not.toContain('<em>')
    })

    it('should handle DC.creator meta tag for author', async () => {
      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Book</title>
  <meta name="DC.creator" content="Jane Smith" />
</head>
<body><p>Content</p></body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)

      expect(book.author).toBe('Jane Smith')
    })
  })
})
