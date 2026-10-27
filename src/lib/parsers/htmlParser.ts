import type { Book, BookParser, Chapter, OnParseProgress } from '../types/book'
import { readFileAsText } from '../fileUtils'
import { htmlToText, sanitizeChapterHtml } from '../html/chapterHtml'

/**
 * Parser for HTML files.
 *
 * The chapter's content keeps its markup — headings, lists, tables and images
 * are what the reader shows and the app speaks — so this splits the document
 * into chapters by heading and hands each piece to the sanitizer.
 */
export class HtmlParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.html') || ext.endsWith('.htm') || file.type === 'text/html'
  }

  getFormatName(): string {
    return 'HTML'
  }

  async parse(file: File, _onProgress?: OnParseProgress): Promise<Book> {
    const html = await readFileAsText(file)
    const doc = new DOMParser().parseFromString(html, 'text/html')

    return {
      title: this.extractTitle(doc),
      author: this.extractAuthor(doc),
      chapters: this.extractChapters(doc),
      format: 'html',
    }
  }

  private extractTitle(doc: Document): string {
    return (
      doc.querySelector('meta[name="title"]')?.getAttribute('content')?.trim() ||
      doc.querySelector('title')?.textContent?.trim() ||
      htmlToText(doc.body?.innerHTML ?? '').slice(0, 80) ||
      'Untitled'
    )
  }

  private extractAuthor(doc: Document): string {
    const meta =
      doc.querySelector('meta[name="author"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="DC.creator"]')?.getAttribute('content')
    return meta?.trim() || 'Unknown'
  }

  /**
   * The headings that start a chapter: the shallowest level that has more than
   * one, so a page with a single title and several sections splits on sections.
   */
  private chapterHeadings(doc: Document): Element[] {
    for (const level of ['h1', 'h2', 'h3']) {
      const found = Array.from(doc.querySelectorAll(level))
      if (found.length >= 2) return found
    }
    const anyLevel = Array.from(doc.querySelectorAll('h1, h2, h3'))
    return anyLevel.length === 1 ? anyLevel : []
  }

  private extractChapters(doc: Document): Chapter[] {
    const body = doc.body
    if (!body) return []

    const headings = this.chapterHeadings(doc)
    if (headings.length === 0) return this.singleChapter(doc)

    const chapters: Chapter[] = []
    headings.forEach((heading, index) => {
      const next = headings[index + 1]
      const title = heading.textContent?.replace(/\s+/g, ' ').trim() || `Chapter ${index + 1}`

      // Ranges copy across whatever nesting the page uses, so a heading buried
      // in a div still splits at the right place.
      const range = doc.createRange()
      if (index === 0) range.setStart(body, 0)
      else range.setStartAfter(heading)
      if (next) range.setEndBefore(next)
      else range.setEnd(body, body.childNodes.length)

      const holder = doc.createElement('div')
      holder.appendChild(range.cloneContents())
      this.dropTitleHeading(holder, title)

      const content = sanitizeChapterHtml(holder.innerHTML)
      if (htmlToText(content)) chapters.push({ id: `chapter-${index + 1}`, title, content })
    })

    return chapters.length > 0 ? chapters : this.singleChapter(doc)
  }

  /** No headings: the whole page is one chapter, titled by its first line. */
  private singleChapter(doc: Document): Chapter[] {
    const content = sanitizeChapterHtml(doc.body?.innerHTML ?? '')
    const text = htmlToText(content)
    if (!text) return []

    return [{ id: 'full-document', title: text.slice(0, 80), content }]
  }

  /**
   * The reader prints the chapter title above the chapter, so a heading that
   * repeats it would be shown and spoken twice.
   */
  private dropTitleHeading(holder: Element, title: string): void {
    const normalize = (value: string | null | undefined) =>
      (value ?? '').replace(/\s+/g, ' ').trim()
    const heading = Array.from(holder.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
      (candidate) => normalize(candidate.textContent) === normalize(title)
    )
    heading?.remove()
  }
}

// Export singleton instance
export const htmlParser = new HtmlParser()
