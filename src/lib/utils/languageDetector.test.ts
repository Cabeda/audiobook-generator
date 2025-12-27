import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  detectChapterLanguage,
  hashText,
  shouldTrustDetection,
  DETECTION_CONFIDENCE_THRESHOLD,
} from './languageDetector'

describe('languageDetector', () => {
  describe('detectLanguage', () => {
    it('should detect English text', () => {
      const text = 'This is a sample English text. The quick brown fox jumps over the lazy dog.'
      const result = detectLanguage(text)

      expect(result.languageCode).toBe('en')
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('should detect Spanish text', () => {
      const text =
        'Este es un texto de ejemplo en español. El rápido zorro marrón salta sobre el perro perezoso.'
      const result = detectLanguage(text)

      expect(result.languageCode).toBe('es')
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('should detect French text', () => {
      const text =
        'Ceci est un exemple de texte en français. Le rapide renard brun saute par-dessus le chien paresseux.'
      const result = detectLanguage(text)

      expect(result.languageCode).toBe('fr')
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('should return low confidence for very short text', () => {
      const text = 'Hello'
      const result = detectLanguage(text)

      expect(result.confidence).toBe(0)
      expect(result.languageCode).toBe('und')
    })

    it('should return low confidence for empty text', () => {
      const text = ''
      const result = detectLanguage(text)

      expect(result.confidence).toBe(0)
      expect(result.languageCode).toBe('und')
    })

    it('should increase confidence for longer texts', () => {
      const shortText = 'This is a short English text for testing purposes only.'
      const longText = 'This is a much longer English text for testing purposes. '.repeat(10)

      const shortResult = detectLanguage(shortText)
      const longResult = detectLanguage(longText)

      // Longer text should have higher or equal confidence
      expect(longResult.confidence).toBeGreaterThanOrEqual(shortResult.confidence)
    })

    it('should handle text with only whitespace', () => {
      const text = '   \n\t  '
      const result = detectLanguage(text)

      expect(result.languageCode).toBe('und')
      expect(result.confidence).toBe(0)
    })
  })

  describe('detectChapterLanguage', () => {
    it('should work as an alias for detectLanguage', () => {
      const content = 'This is chapter content in English.'
      const result = detectChapterLanguage(content)

      expect(result.languageCode).toBe('en')
      expect(result.confidence).toBeGreaterThan(0)
    })
  })

  describe('hashText', () => {
    it('should generate consistent hash for same text', () => {
      const text = 'Sample text for hashing'
      const hash1 = hashText(text)
      const hash2 = hashText(text)

      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different texts', () => {
      const text1 = 'First text'
      const text2 = 'Second text'
      const hash1 = hashText(text1)
      const hash2 = hashText(text2)

      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty string', () => {
      const hash = hashText('')
      expect(hash).toBeDefined()
      expect(typeof hash).toBe('string')
    })
  })

  describe('shouldTrustDetection', () => {
    it('should trust detection with high confidence', () => {
      const result = {
        languageCode: 'en',
        confidence: 0.9,
      }

      expect(shouldTrustDetection(result)).toBe(true)
    })

    it('should trust detection at threshold', () => {
      const result = {
        languageCode: 'en',
        confidence: DETECTION_CONFIDENCE_THRESHOLD,
      }

      expect(shouldTrustDetection(result)).toBe(true)
    })

    it('should not trust detection below threshold', () => {
      const result = {
        languageCode: 'en',
        confidence: DETECTION_CONFIDENCE_THRESHOLD - 0.1,
      }

      expect(shouldTrustDetection(result)).toBe(false)
    })

    it('should not trust undetermined language', () => {
      const result = {
        languageCode: 'und',
        confidence: 0.9,
      }

      expect(shouldTrustDetection(result)).toBe(false)
    })

    it('should not trust detection with zero confidence', () => {
      const result = {
        languageCode: 'en',
        confidence: 0,
      }

      expect(shouldTrustDetection(result)).toBe(false)
    })
  })

  describe('DETECTION_CONFIDENCE_THRESHOLD', () => {
    it('should be a reasonable value between 0 and 1', () => {
      expect(DETECTION_CONFIDENCE_THRESHOLD).toBeGreaterThan(0)
      expect(DETECTION_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1)
    })
  })
})
