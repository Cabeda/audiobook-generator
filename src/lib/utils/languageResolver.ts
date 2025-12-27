import type { Book, Chapter } from '../types/book'
import { DETECTION_CONFIDENCE_THRESHOLD as IMPORTED_THRESHOLD } from './languageDetector'

/**
 * Default language when none is specified
 */
export const DEFAULT_LANGUAGE = 'en'

/**
 * Confidence threshold for trusting detected language
 * Re-exported from languageDetector for convenience
 */
export const DETECTION_CONFIDENCE_THRESHOLD = IMPORTED_THRESHOLD

/**
 * Resolves the effective language for a chapter.
 * Returns chapter language if set, otherwise falls back to book language, then DEFAULT_LANGUAGE.
 */
export function resolveChapterLanguage(chapter: Chapter, book: Book): string {
  return chapter.language || book.language || DEFAULT_LANGUAGE
}

/**
 * Resolves the effective language for a chapter including auto-detected language.
 * Resolution order:
 * 1. chapter.language (user override)
 * 2. chapter.detectedLanguage (if confidence >= threshold)
 * 3. book.language (book default)
 * 4. DEFAULT_LANGUAGE (app default)
 *
 * @param chapter The chapter to resolve language for
 * @param book The book containing the chapter
 * @returns Resolved language code (ISO 639-1)
 */
export function resolveChapterLanguageWithDetection(chapter: Chapter, book: Book): string {
  // 1. User override takes precedence
  if (chapter.language) {
    return chapter.language
  }

  // 2. Auto-detected language if confident enough
  if (
    chapter.detectedLanguage &&
    chapter.detectedLanguage !== 'und' &&
    chapter.languageConfidence !== undefined &&
    chapter.languageConfidence >= IMPORTED_THRESHOLD
  ) {
    return chapter.detectedLanguage
  }

  // 3. Book default
  if (book.language) {
    return book.language
  }

  // 4. App default
  return DEFAULT_LANGUAGE
}

/**
 * Common language options for UI dropdowns
 */
export interface LanguageOption {
  code: string
  label: string
  flag: string
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', label: 'French', flag: '🇫🇷' },
  { code: 'de', label: 'German', flag: '🇩🇪' },
  { code: 'it', label: 'Italian', flag: '🇮🇹' },
  { code: 'pt', label: 'Portuguese', flag: '🇵🇹' },
  { code: 'nl', label: 'Dutch', flag: '🇳🇱' },
  { code: 'pl', label: 'Polish', flag: '🇵🇱' },
  { code: 'ru', label: 'Russian', flag: '🇷🇺' },
  { code: 'ja', label: 'Japanese', flag: '🇯🇵' },
  { code: 'zh', label: 'Chinese', flag: '🇨🇳' },
  { code: 'ko', label: 'Korean', flag: '🇰🇷' },
  { code: 'ar', label: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', label: 'Hindi', flag: '🇮🇳' },
]

/**
 * Get language label from code
 */
export function getLanguageLabel(code: string): string {
  const option = LANGUAGE_OPTIONS.find((opt) => opt.code === code)
  return option ? `${option.flag} ${option.label}` : code.toUpperCase()
}

/**
 * Check if a chapter has a language override different from the book default
 */
export function hasLanguageOverride(chapter: Chapter, book: Book): boolean {
  if (chapter.language === undefined) return false
  // Compare to what the language would be if chapter.language were not set
  const effectiveLanguage = resolveChapterLanguage({ ...chapter, language: undefined }, book)
  return chapter.language !== effectiveLanguage
}
