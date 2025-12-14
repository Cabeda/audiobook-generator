import { detectFormat } from './formatDetector'
import logger from './utils/logger'
import type { Book, BookParser } from './types/book'

/**
 * Lazy load EPUB parser to support dynamic imports
 */
async function getEpubParser(): Promise<BookParser | null> {
  try {
    const { epubParser } = await import('./epubParser')
    return epubParser
  } catch (e) {
    logger.warn('EPUB parser not available:', e)
    return null
  }
}

/**
 * Lazy load TXT parser to support dynamic imports
 */
async function getTxtParser(): Promise<BookParser | null> {
  try {
    const { txtParser } = await import('./parsers/txtParser')
    return txtParser
  } catch (e) {
    logger.warn('TXT parser not available:', e)
    return null
  }
}

/**
 * Lazy load HTML parser to support dynamic imports
 */
async function getHtmlParser(): Promise<BookParser | null> {
  try {
    const { htmlParser } = await import('./parsers/htmlParser')
    return htmlParser
  } catch (e) {
    logger.warn('HTML parser not available:', e)
    return null
  }
}

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
    logger.warn('PDF parser not available:', e)
    return null
  }
}

/**
 * Get all available parsers
 * All parsers are loaded dynamically to support code splitting and dynamic imports
 */
async function getAllParsers(): Promise<BookParser[]> {
  const parsers: (BookParser | null)[] = await Promise.all([
    getEpubParser(),
    getTxtParser(),
    getHtmlParser(),
    getPdfParser(),
  ])

  return parsers.filter((parser): parser is BookParser => parser !== null)
}

/**
 * Load a book file, automatically detecting format and using appropriate parser
 */
export async function loadBook(file: File): Promise<Book> {
  const format = await detectFormat(file)
  logger.info(`Detected format: ${format}`)

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

  logger.info(`Using parser: ${parser.getFormatName()}`)

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
