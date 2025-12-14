import type { Book, Chapter } from '../types/book'

/**
 * Default language when none is specified
 */
export const DEFAULT_LANGUAGE = 'en'

/**
 * Resolves the effective language for a chapter.
 * Returns chapter language if set, otherwise falls back to book language, then DEFAULT_LANGUAGE.
 */
export function resolveChapterLanguage(chapter: Chapter, book: Book): string {
  return chapter.language || book.language || DEFAULT_LANGUAGE
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
