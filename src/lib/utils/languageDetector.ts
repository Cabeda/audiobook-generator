import { franc } from 'franc-min'

/**
 * Language detection result
 */
export interface LanguageDetectionResult {
  languageCode: string
  confidence: number
}

/**
 * Confidence threshold for accepting detected language
 * Below this threshold, we should fall back to book default
 */
export const DETECTION_CONFIDENCE_THRESHOLD = 0.5

/**
 * Maximum number of characters to sample for detection
 * Keeps detection fast and limits processing time
 */
const MAX_SAMPLE_LENGTH = 1000

/**
 * Minimum text length required for reliable detection
 */
const MIN_TEXT_LENGTH = 20

/**
 * Detect the language of a text sample
 * Uses franc-min for lightweight detection
 *
 * @param text The text to analyze
 * @returns Detection result with ISO 639-3 code converted to ISO 639-1 and confidence
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  // Clean and normalize text
  const cleanText = text.trim()

  // Check minimum length
  if (cleanText.length < MIN_TEXT_LENGTH) {
    return {
      languageCode: 'und', // undetermined
      confidence: 0,
    }
  }

  // Sample text to limit processing
  const sample = cleanText.slice(0, MAX_SAMPLE_LENGTH)

  // Detect using franc (returns ISO 639-3 code or 'und' if uncertain)
  const detected = franc(sample, { minLength: MIN_TEXT_LENGTH })

  // Convert ISO 639-3 to ISO 639-1 (franc returns 3-letter codes)
  const languageCode = convertISO639_3to1(detected)

  // Calculate confidence based on text length and detection result
  // NOTE: franc doesn't provide actual linguistic confidence scores.
  // These confidence values are heuristic estimates based on:
  // - Whether detection succeeded (not 'und')
  // - Text length (longer text = more reliable detection)
  // These are NOT actual confidence scores from the detection library.
  let confidence = 0
  if (languageCode !== 'und') {
    // Base confidence for successful detection
    confidence = 0.6

    // Boost confidence for longer texts
    if (cleanText.length >= 500) {
      confidence = 0.9
    } else if (cleanText.length >= 200) {
      confidence = 0.75
    }
  }

  return {
    languageCode,
    confidence,
  }
}

/**
 * Detect language for a chapter's content
 * @param content Chapter text content
 * @returns Detection result
 */
export function detectChapterLanguage(content: string): LanguageDetectionResult {
  return detectLanguage(content)
}

/**
 * Convert ISO 639-3 code to ISO 639-1 code
 * franc returns 3-letter codes, but we use 2-letter codes
 */
function convertISO639_3to1(code3: string): string {
  const map: Record<string, string> = {
    eng: 'en',
    spa: 'es',
    fra: 'fr',
    deu: 'de',
    ita: 'it',
    por: 'pt',
    nld: 'nl',
    pol: 'pl',
    rus: 'ru',
    jpn: 'ja',
    cmn: 'zh', // Mandarin Chinese - franc may detect either cmn or zho for Chinese text
    zho: 'zh', // Chinese (generic) - both map to 'zh' as TTS engines don't distinguish varieties
    kor: 'ko',
    arb: 'ar', // Standard Arabic - franc may detect either arb or ara for Arabic text
    ara: 'ar', // Arabic (generic) - both map to 'ar' as TTS engines don't distinguish varieties
    hin: 'hi',
    und: 'und', // undetermined
  }

  return map[code3] || 'und'
}

/**
 * Simple hash function for content-based caching
 * @param text Text to hash
 * @returns Hash string
 */
export function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(36)
}

/**
 * Check if a detected language should be trusted based on confidence
 */
export function shouldTrustDetection(result: LanguageDetectionResult): boolean {
  return result.languageCode !== 'und' && result.confidence >= DETECTION_CONFIDENCE_THRESHOLD
}
