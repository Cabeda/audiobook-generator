import * as pdfjsLib from 'pdfjs-dist'
import logger from '../utils/logger'
import type { Book, BookParser, Chapter } from '../types/book'

// Configure PDF.js worker
// In browser, this should point to the worker file from pdfjs-dist
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
}

interface TextItem {
  str: string
  height: number
  transform: number[]
}

/**
 * Parser for PDF files
 * Extracts text and attempts to detect chapters via font size analysis
 */
export class PdfParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.pdf') || file.type === 'application/pdf'
  }

  getFormatName(): string {
    return 'PDF'
  }

  async parse(file: File): Promise<Book> {
    const arrayBuffer = await file.arrayBuffer()

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise

    // Extract metadata
    const metadata = await this.extractMetadata(pdf)

    // Extract text from all pages with formatting info
    const pages = await this.extractAllPages(pdf)

    // Detect chapters based on font sizes and formatting
    const chapters = this.detectChapters(pages)

    return {
      title: metadata.title,
      author: metadata.author,
      chapters,
      format: 'pdf',
    }
  }

  /**
   * Extract metadata from PDF
   */
  private async extractMetadata(pdf: pdfjsLib.PDFDocumentProxy): Promise<{
    title: string
    author: string
  }> {
    try {
      const metadata = await pdf.getMetadata()
      const info = metadata.info as {
        Title?: string
        Author?: string
        Subject?: string
      }

      return {
        title: info.Title || 'Untitled PDF',
        author: info.Author || 'Unknown',
      }
    } catch (e) {
      logger.warn('Failed to extract PDF metadata:', e)
      return {
        title: 'Untitled PDF',
        author: 'Unknown',
      }
    }
  }

  /**
   * Extract text and formatting from all pages
   */
  private async extractAllPages(pdf: pdfjsLib.PDFDocumentProxy): Promise<
    {
      pageNum: number
      text: string
      items: TextItem[]
    }[]
  > {
    const pages: { pageNum: number; text: string; items: TextItem[] }[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()

      const items: TextItem[] = []
      let text = ''

      for (const item of textContent.items) {
        if ('str' in item) {
          items.push({
            str: item.str,
            height: item.height || 12,
            transform: item.transform || [1, 0, 0, 1, 0, 0],
          })
          text += item.str + ' '
        }
      }

      pages.push({
        pageNum: i,
        text: text.trim(),
        items,
      })
    }

    return pages
  }

  /**
   * Detect chapters using font size analysis
   * Larger font sizes typically indicate chapter headings
   */
  private detectChapters(pages: { pageNum: number; text: string; items: TextItem[] }[]): Chapter[] {
    // Find the most common font sizes
    const fontSizes: number[] = []
    pages.forEach((page) => {
      page.items.forEach((item) => {
        fontSizes.push(item.height)
      })
    })

    // Calculate average font size (body text)
    const averageSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length

    // Consider anything 1.5x larger than average as a potential heading
    const headingThreshold = averageSize * 1.5

    const chapterCandidates: {
      pageNum: number
      text: string
      fontSize: number
      index: number
    }[] = []

    // Find potential chapter headings (large text)
    pages.forEach((page) => {
      page.items.forEach((item, idx) => {
        if (item.height >= headingThreshold && item.str.trim().length > 3) {
          // Check if it looks like a chapter heading
          const text = item.str.trim()
          if (
            /^(chapter|ch\.?)\s+\d+/i.test(text) ||
            /^(part|section)\s+\d+/i.test(text) ||
            /^\d+\.\s+[A-Z]/.test(text) || // "1. Something"
            (text.length < 80 && text === text.toUpperCase()) // ALL CAPS short text
          ) {
            chapterCandidates.push({
              pageNum: page.pageNum,
              text,
              fontSize: item.height,
              index: idx,
            })
          }
        }
      })
    })

    // If we found chapter markers, use them
    if (chapterCandidates.length >= 2) {
      return this.createChaptersFromMarkers(pages, chapterCandidates)
    }

    // Fallback: split by pages (groups of 10 pages)
    return this.createChaptersByPageGroups(pages)
  }

  /**
   * Create chapters based on detected markers
   */
  private createChaptersFromMarkers(
    pages: { pageNum: number; text: string; items: TextItem[] }[],
    markers: { pageNum: number; text: string; fontSize: number; index: number }[]
  ): Chapter[] {
    const chapters: Chapter[] = []

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]
      const nextMarker = markers[i + 1]

      // Collect pages from this marker to the next
      const startPage = marker.pageNum
      const endPage = nextMarker ? nextMarker.pageNum - 1 : pages.length

      const chapterPages = pages.filter((p) => p.pageNum >= startPage && p.pageNum <= endPage)

      const content = chapterPages
        .map((p) => p.text)
        .join('\n\n')
        .trim()

      if (content.length > 0) {
        chapters.push({
          id: `chapter-${i + 1}`,
          title: marker.text,
          content,
        })
      }
    }

    return chapters
  }

  /**
   * Fallback: Create chapters by grouping pages
   */
  private createChaptersByPageGroups(
    pages: { pageNum: number; text: string; items: TextItem[] }[]
  ): Chapter[] {
    const chapters: Chapter[] = []
    const pagesPerChapter = 10

    for (let i = 0; i < pages.length; i += pagesPerChapter) {
      const chapterPages = pages.slice(i, i + pagesPerChapter)
      const content = chapterPages
        .map((p) => p.text)
        .join('\n\n')
        .trim()

      if (content.length > 0) {
        const startPage = chapterPages[0].pageNum
        const endPage = chapterPages[chapterPages.length - 1].pageNum

        chapters.push({
          id: `pages-${startPage}-${endPage}`,
          title: `Pages ${startPage}-${endPage}`,
          content,
        })
      }
    }

    return chapters
  }
}

// Export singleton instance
export const pdfParser = new PdfParser()
