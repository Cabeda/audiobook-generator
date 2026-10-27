import { describe, it, expect } from 'vitest'
import { parseArticle } from './articleParser'
import { htmlToText } from '../html/chapterHtml'

const body = `
  <p>${'The article says something worth reading. '.repeat(6)}</p>
  <h2>A subheading</h2>
  <p>${'More of the same argument, in more words. '.repeat(6)}</p>
  <ul><li>First point</li><li>Second point</li></ul>
  <table><tr><th>Name</th><th>Age</th></tr><tr><td>Bob</td><td>42</td></tr></table>
  <figure><img src="images/chart.png" alt="A chart"><figcaption>Sales by quarter</figcaption></figure>
  <p>${'Closing remarks that also run long enough. '.repeat(4)}</p>`

function page(extra = ''): string {
  return `<!DOCTYPE html><html><head>
    <title>Site — Some Article</title>
    <meta name="author" content="Jane Smith">
  </head><body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <article>
      <h1>The Article Title</h1>
      ${body}
    </article>
    <aside>Related: <a href="/x">Something else</a></aside>
    ${extra}
  </body></html>`
}

describe('parseArticle', () => {
  it('extracts the article as one chapter', () => {
    const book = parseArticle(page(), 'https://example.com/posts/article')

    expect(book).not.toBeNull()
    expect(book!.chapters).toHaveLength(1)
    expect(book!.title).toBe('The Article Title')
    expect(book!.format).toBe('article')
  })

  it('leaves the navigation and the related list behind', () => {
    const book = parseArticle(page(), 'https://example.com/posts/article')
    const content = book!.chapters[0].content

    expect(content).not.toContain('About')
    expect(content).not.toContain('Something else')
    expect(content).toContain('A subheading')
  })

  it('keeps lists, tables and captions', () => {
    const book = parseArticle(page(), 'https://example.com/posts/article')
    const content = book!.chapters[0].content

    expect(content).toContain('<li>First point</li>')
    expect(content).toContain('<td>42</td>')
    expect(content).toContain('<figcaption>Sales by quarter</figcaption>')
  })

  it('resolves relative images against the page URL', () => {
    const book = parseArticle(page(), 'https://example.com/posts/article')
    const content = book!.chapters[0].content

    expect(content).toContain('https://example.com/posts/images/chart.png')
  })

  it('does not repeat the title as a heading', () => {
    const book = parseArticle(page(), 'https://example.com/posts/article')
    const content = book!.chapters[0].content

    expect(htmlToText(content)).not.toContain('The Article Title')
    expect(book!.chapters[0].title).toBe('The Article Title')
  })

  it('gives up on a page with no article, so the caller can fall back', () => {
    const navOnly = `<!DOCTYPE html><html><head><title>Menu</title></head>
      <body><nav><a href="/">Home</a><a href="/about">About</a></nav></body></html>`

    expect(parseArticle(navOnly, 'https://example.com')).toBeNull()
  })
})
