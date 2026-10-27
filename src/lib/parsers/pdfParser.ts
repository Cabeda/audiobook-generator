import * as pdfjsLib from 'pdfjs-dist'
import logger from '../utils/logger'
import type { Book, BookParser, OnParseProgress } from '../types/book'
import { pagesToBook, type PdfPageInput } from './pdfLayout'

// Configure PDF.js worker
// In browser, this should point to the worker file from pdfjs-dist
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
}

/**
 * Parser for PDF files.
 *
 * A PDF is glyphs at coordinates, not text, so the work is geometry: this reads
 * the items pdf.js reports and hands them to `pdfLayout`, which rebuilds the
 * lines, paragraphs, headings, lists and tables a chapter is made of.
 */
export class PdfParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.pdf') || file.type === 'application/pdf'
  }

  getFormatName(): string {
    return 'PDF'
  }

  async parse(file: File, onProgress?: OnParseProgress): Promise<Book> {
    onProgress?.({ percent: 0, step: 'Reading PDF file...' })
    const arrayBuffer = await file.arrayBuffer()

    onProgress?.({ percent: 0.1, step: 'Loading PDF document...' })
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loadingTask.promise

    onProgress?.({ percent: 0.2, step: 'Extracting metadata...' })
    const metadata = await this.extractMetadata(pdf)

    onProgress?.({ percent: 0.3, step: 'Extracting pages...' })
    const pages = await this.extractAllPages(pdf, onProgress)

    onProgress?.({ percent: 0.95, step: 'Detecting chapters...' })
    return pagesToBook(pages, metadata)
  }

  private async extractMetadata(
    pdf: pdfjsLib.PDFDocumentProxy
  ): Promise<{ title?: string; author?: string }> {
    try {
      const metadata = await pdf.getMetadata()
      const info = metadata.info as { Title?: string; Author?: string }
      return {
        // Absent metadata is common; the document's own first heading names it.
        title: info.Title?.trim() || undefined,
        author: info.Author?.trim() || undefined,
      }
    } catch (e) {
      logger.warn('Failed to extract PDF metadata:', e)
      return {}
    }
  }

  /** The text items of every page, with the geometry the layout needs. */
  private async extractAllPages(
    pdf: pdfjsLib.PDFDocumentProxy,
    onProgress?: OnParseProgress
  ): Promise<PdfPageInput[]> {
    const pages: PdfPageInput[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()

      const items = textContent.items.flatMap((item) =>
        'str' in item
          ? [
              {
                str: item.str,
                height: item.height || 12,
                transform: item.transform || [1, 0, 0, 1, 0, 0],
                width: item.width,
                fontName: item.fontName,
              },
            ]
          : []
      )

      pages.push({ pageNum: i, items })

      // Report per-page progress (0.3 to 0.9 range)
      const pageProgress = 0.3 + (i / pdf.numPages) * 0.6
      onProgress?.({
        percent: pageProgress,
        step: `Extracting page ${i} of ${pdf.numPages}...`,
      })
    }

    return pages
  }
}

// Export singleton instance
export const pdfParser = new PdfParser()
