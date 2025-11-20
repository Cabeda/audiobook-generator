import type { Book, BookParser, Chapter } from '../types/book'
import { readFileAsText } from '../fileUtils'

/**
 * Parser for HTML files
 * Extracts chapters from heading tags and metadata from HTML meta tags
 */
export class HtmlParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.html') || ext.endsWith('.htm') || file.type === 'text/html'
  }

  getFormatName(): string {
    return 'HTML'
  }

  async parse(file: File): Promise<Book> {
    const html = await readFileAsText(file)
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Extract metadata
    const metadata = this.extractMetadata(doc)

    // Extract chapters from heading structure
    const chapters = this.extractChapters(doc)

    return {
      title: metadata.title,
      author: metadata.author,
      chapters,
      format: 'html',
    }
  }

  /**
   * Extract title and author from HTML meta tags and title
   */
  private extractMetadata(doc: Document): {
    title: string
    author: string
  } {
    // Try <title> tag
    let title = doc.querySelector('title')?.textContent?.trim() || 'Untitled'

    // Try meta tags
    const metaTitle = doc.querySelector('meta[name="title"]')?.getAttribute('content')
    const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute('content')
    const dcCreator = doc.querySelector('meta[name="DC.creator"]')?.getAttribute('content')

    if (metaTitle) title = metaTitle

    const author = metaAuthor || dcCreator || 'Unknown'

    return { title, author }
  }

  /**
   * Extract chapters based on heading structure
   * Uses h1 or h2 tags as chapter markers
   */
  private extractChapters(doc: Document): Chapter[] {
    // Try h1 first, fall back to h2 if no h1s found
    let headings = Array.from(doc.querySelectorAll('h1'))

    if (headings.length < 2) {
      headings = Array.from(doc.querySelectorAll('h2'))
    }

    // If still no headings, try h3
    if (headings.length < 2) {
      headings = Array.from(doc.querySelectorAll('h3'))
    }

    // If we have headings, use them to split chapters
    if (headings.length >= 1) {
      return this.extractChaptersByHeadings(headings)
    }

    // Fallback: treat entire body as one chapter
    return this.extractSingleChapter(doc)
  }

  /**
   * Extract chapters using heading tags as delimiters
   */
  private extractChaptersByHeadings(headings: Element[]): Chapter[] {
    const chapters: Chapter[] = []

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i]
      const title = heading.textContent?.trim() || `Chapter ${i + 1}`

      // Collect content between this heading and the next
      const content: string[] = []
      let currentNode: Node | null = heading.nextSibling
      const nextHeading = headings[i + 1]

      while (currentNode && currentNode !== nextHeading) {
        if (currentNode.nodeType === Node.ELEMENT_NODE) {
          const element = currentNode as Element
          // Skip other headings of the same level
          if (!this.isHeading(element)) {
            const text = this.cleanText(element.textContent || '')
            if (text) content.push(text)
          }
        } else if (currentNode.nodeType === Node.TEXT_NODE) {
          const text = this.cleanText(currentNode.textContent || '')
          if (text) content.push(text)
        }
        currentNode = this.getNextNode(currentNode, nextHeading)
      }

      const chapterContent = content.join('\n\n').trim()

      if (chapterContent.length > 0) {
        chapters.push({
          id: `chapter-${i + 1}`,
          title,
          content: chapterContent,
        })
      }
    }

    return chapters.length > 0
      ? chapters
      : this.extractSingleChapterFromBody(headings[0].ownerDocument!)
  }

  /**
   * Get the next node in document order, stopping before a specific node
   */
  private getNextNode(node: Node, stopBefore: Node | null): Node | null {
    if (node === stopBefore) return null

    // If has children, go to first child
    if (node.firstChild) {
      return node.firstChild
    }

    // If has next sibling, go there
    if (node.nextSibling) {
      if (node.nextSibling === stopBefore) return null
      return node.nextSibling
    }

    // Go up to parent and find next sibling
    let parent = node.parentNode
    while (parent) {
      if (parent.nextSibling) {
        if (parent.nextSibling === stopBefore) return null
        return parent.nextSibling
      }
      parent = parent.parentNode
    }

    return null
  }

  /**
   * Check if element is a heading tag
   */
  private isHeading(element: Element): boolean {
    return /^H[1-6]$/.test(element.tagName)
  }

  /**
   * Extract single chapter from entire document body
   */
  private extractSingleChapter(doc: Document): Chapter[] {
    const body = doc.body
    if (!body) return []

    const content = this.cleanText(body.textContent || '').trim()

    if (content.length === 0) return []

    // Use first line or first 80 characters as title
    const firstLine = content.split('\n')[0].substring(0, 80)

    return [
      {
        id: 'full-document',
        title: firstLine || 'Full Document',
        content,
      },
    ]
  }

  /**
   * Extract single chapter from body (used when chapter extraction fails)
   */
  private extractSingleChapterFromBody(doc: Document): Chapter[] {
    return this.extractSingleChapter(doc)
  }

  /**
   * Clean text by removing extra whitespace and normalizing line breaks
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Collapse whitespace
      .replace(/\n\s*\n/g, '\n\n') // Normalize paragraph breaks
      .trim()
  }
}

// Export singleton instance
export const htmlParser = new HtmlParser()
