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

    it('should keep the markup that carries structure', async () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Chapter</h1>
  <p>This is <strong>bold</strong> and <em>italic</em> text.</p>
  <ul><li>First</li><li>Second</li></ul>
  <table><tr><th>Name</th><th>Age</th></tr><tr><td>Bob</td><td>42</td></tr></table>
  <figure><img src="https://example.com/a.png" alt="A chart"><figcaption>Sales</figcaption></figure>
</body>
</html>`

      const file = new File([html], 'book.html', { type: 'text/html' })
      const book = await htmlParser.parse(file)
      const content = book.chapters[0].content

      expect(content).toContain('<strong>bold</strong>')
      expect(content).toContain('<ul><li>First</li>')
      expect(content).toContain('<th>Name</th>')
      expect(content).toContain('<td>42</td>')
      expect(content).toContain('<figcaption>Sales</figcaption>')
      expect(content).toContain('src="https://example.com/a.png"')
    })

    it('should not show the chapter title twice', async () => {
      const html = `<html><body>
  <h1>Chapter One</h1>
  <p>Body.</p>
  <h1>Chapter Two</h1>
  <p>More body.</p>
</body></html>`

      const book = await htmlParser.parse(new File([html], 'book.html', { type: 'text/html' }))

      expect(book.chapters[0].title).toBe('Chapter One')
      expect(book.chapters[0].content).not.toContain('Chapter One')
      expect(book.chapters[0].content).toContain('<p>Body.</p>')
    })

    it('should keep subheadings inside a chapter', async () => {
      const html = `<html><body>
  <h1>One</h1>
  <p>text</p>
  <h2>Part</h2>
  <p>more</p>
  <h1>Two</h1>
  <p>end</p>
</body></html>`

      const book = await htmlParser.parse(new File([html], 'book.html', { type: 'text/html' }))

      expect(book.chapters).toHaveLength(2)
      expect(book.chapters[0].content).toContain('<h2>Part</h2>')
    })

    it('should split nested headings even when they sit inside a div', async () => {
      const html = `<html><body><div class="wrapper">
  <h2>First</h2>
  <p>one</p>
  <h2>Second</h2>
  <p>two</p>
</div></body></html>`

      const book = await htmlParser.parse(new File([html], 'book.html', { type: 'text/html' }))

      expect(book.chapters).toHaveLength(2)
      expect(book.chapters[0].title).toBe('First')
      expect(book.chapters[0].content).toContain('one')
      expect(book.chapters[0].content).not.toContain('two')
    })

    it('should drop scripts and inline handlers', async () => {
      const html = `<html><body><h1>One</h1><h1>Two</h1>
  <p onclick="steal()">safe<script>alert(1)</script></p>
</body></html>`

      const book = await htmlParser.parse(new File([html], 'book.html', { type: 'text/html' }))

      expect(book.chapters[0].content).not.toContain('script')
      expect(book.chapters[0].content).not.toContain('onclick')
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
