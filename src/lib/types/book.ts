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
}

export interface Chapter {
  id: string
  title: string
  content: string
  language?: string // Optional language override (ISO 639-1 code)
  detectedLanguage?: string // Auto-detected language (ISO 639-1 code)
  languageConfidence?: number // Detection confidence (0-1)
  model?: string // Optional TTS model override (e.g., 'kokoro', 'piper')
  voice?: string // Optional voice override for this chapter
}

/**
 * Progress callback for book parsing
 */
export interface ParseProgress {
  /** 0–1 fraction of completion */
  percent: number
  /** Human-readable description of the current step */
  step: string
}

export type OnParseProgress = (progress: ParseProgress) => void

/**
 * Interface that all book parsers must implement
 */
export interface BookParser {
  /** Check if this parser can handle the given file */
  canParse(file: File): Promise<boolean>

  /** Parse the file into a Book */
  parse(file: File, onProgress?: OnParseProgress): Promise<Book>

  /** Get the format name this parser handles */
  getFormatName(): string
}
