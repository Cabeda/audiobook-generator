/**
 * Common book format returned by all parsers
 */
export interface Book {
  title: string
  author: string
  cover?: string // Object URL or data URL
  chapters: Chapter[]
  format?: string // Original format (epub, pdf, txt, etc.)
}

export interface Chapter {
  id: string
  title: string
  content: string
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
