/**
 * Image resource embedded in book content
 */
export interface ImageResource {
  id: string
  url: string // Can be external URL or data URL
  alt?: string
}

/**
 * Common book format returned by all parsers
 */
export interface Book {
  title: string
  author: string
  cover?: string // Object URL or data URL
  chapters: Chapter[]
  format?: string // Original format (epub, pdf, txt, etc.)
  language?: string // ISO 639-1 language code (e.g., 'en', 'es', 'fr')
  images?: ImageResource[] // Embedded images for HTML content
}

export interface Chapter {
  id: string
  title: string
  content: string // Plain text content for TTS
  htmlContent?: string // Optional HTML content for rich display
}

/**
 * Interface that all book parsers must implement
 */
export interface BookParser {
  /** Check if this parser can handle the given file */
  canParse(file: File): Promise<boolean>

  /** Parse the file into a Book */
  parse(file: File): Promise<Book>

  /** Get the format name this parser handles */
  getFormatName(): string
}
