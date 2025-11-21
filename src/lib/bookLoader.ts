import { detectFormat } from './formatDetector'
import { epubParser } from './epubParser'
import { txtParser } from './parsers/txtParser'
import { htmlParser } from './parsers/htmlParser'
import type { Book, BookParser } from './types/book'

/**
 * Lazy load PDF parser to avoid Node.js test environment issues
 * PDF.js requires browser DOM APIs
 */
async function getPdfParser(): Promise<BookParser | null> {
  // Only load in browser environment
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const { pdfParser } = await import('./parsers/pdfParser')
    return pdfParser
  } catch (e) {
    console.warn('PDF parser not available:', e)
    return null
  }
}

/**
 * Get all available parsers
 * PDF parser is loaded dynamically only in browser
 */
async function getAllParsers(): Promise<BookParser[]> {
  const parsers: BookParser[] = [epubParser, txtParser, htmlParser]

  const pdfParser = await getPdfParser()
  if (pdfParser) {
    parsers.push(pdfParser)
  }

  return parsers
}

/**
 * Load a book file, automatically detecting format and using appropriate parser
 */
export async function loadBook(file: File): Promise<Book> {
  const format = await detectFormat(file)
  console.log(`Detected format: ${format}`)

  // Find parser that can handle this file
  const parser = await findParser(file)

  if (!parser) {
    const supportedFormats = await getSupportedFormats()
    throw new Error(
      `Unsupported format: ${format}. ` +
        `Supported formats: ${supportedFormats.join(', ')}. ` +
        `More formats coming soon (MOBI).`
    )
  }

  console.log(`Using parser: ${parser.getFormatName()}`)

  // Parse the file
  return await parser.parse(file)
}

/**
 * Find a parser that can handle this file
 */
async function findParser(file: File): Promise<BookParser | null> {
  const parsers = await getAllParsers()

  for (const parser of parsers) {
    if (await parser.canParse(file)) {
      return parser
    }
  }
  return null
}

/**
 * Get list of supported formats
 */
export async function getSupportedFormats(): Promise<string[]> {
  const parsers = await getAllParsers()
  return parsers.map((p) => p.getFormatName())
}
