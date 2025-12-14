import { describe, it, expect } from 'vitest'
import {
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
  getKokoroVoicesForLanguage,
  getPiperVoicesForLanguage,
} from './voiceSelector'
import type { PiperVoice } from '../piper/piperClient'

describe('voiceSelector', () => {
  describe('selectKokoroVoiceForLanguage', () => {
    it('should select American voice for "en" language', () => {
      const voice = selectKokoroVoiceForLanguage('en')
      expect(voice).toBe('af_heart')
    })

    it('should select American voice for "en-US" language', () => {
      const voice = selectKokoroVoiceForLanguage('en-US')
      expect(voice).toBe('af_heart')
    })

    it('should select British voice for "en-GB" language', () => {
      const voice = selectKokoroVoiceForLanguage('en-GB')
      expect(voice).toBe('bf_emma')
    })

    it('should use preferred voice if compatible with language', () => {
      const voice = selectKokoroVoiceForLanguage('en-US', 'am_adam')
      expect(voice).toBe('am_adam')
    })

    it('should ignore preferred voice if incompatible with language', () => {
      const voice = selectKokoroVoiceForLanguage('en-GB', 'am_adam')
      expect(voice).toBe('bf_emma') // Should default to British voice
    })

    it('should fallback to default for unsupported language', () => {
      const voice = selectKokoroVoiceForLanguage('es')
      expect(voice).toBe('af_heart')
    })

    it('should handle case insensitive language codes', () => {
      const voice = selectKokoroVoiceForLanguage('EN-us')
      expect(voice).toBe('af_heart')
    })
  })

  describe('selectPiperVoiceForLanguage', () => {
    const mockVoices: PiperVoice[] = [
      {
        key: 'en_US-hfc_female-medium',
        name: 'HFC Female',
        language: 'English (US)',
        quality: 'medium',
      },
      { key: 'en_US-lessac-medium', name: 'Lessac', language: 'English (US)', quality: 'medium' },
      { key: 'en_GB-alan-medium', name: 'Alan', language: 'English (GB)', quality: 'medium' },
      { key: 'es_ES-carlfm-x_low', name: 'Carlfm', language: 'Spanish (Spain)', quality: 'x_low' },
      { key: 'fr_FR-siwis-medium', name: 'Siwis', language: 'French (France)', quality: 'medium' },
    ]

    it('should select English voice for "en" language', () => {
      const voice = selectPiperVoiceForLanguage('en', mockVoices)
      expect(voice).toBe('en_US-hfc_female-medium')
    })

    it('should select Spanish voice for "es" language', () => {
      const voice = selectPiperVoiceForLanguage('es', mockVoices)
      expect(voice).toBe('es_ES-carlfm-x_low')
    })

    it('should select French voice for "fr" language', () => {
      const voice = selectPiperVoiceForLanguage('fr', mockVoices)
      expect(voice).toBe('fr_FR-siwis-medium')
    })

    it('should use preferred voice if compatible with language', () => {
      const voice = selectPiperVoiceForLanguage('en', mockVoices, 'en_US-lessac-medium')
      expect(voice).toBe('en_US-lessac-medium')
    })

    it('should ignore preferred voice if incompatible with language', () => {
      const voice = selectPiperVoiceForLanguage('es', mockVoices, 'en_US-lessac-medium')
      expect(voice).toBe('es_ES-carlfm-x_low')
    })

    it('should fallback to English for unsupported language', () => {
      const voice = selectPiperVoiceForLanguage('de', mockVoices)
      expect(voice).toBe('en_US-hfc_female-medium')
    })

    it('should return first voice if no English available', () => {
      const nonEnglishVoices: PiperVoice[] = [
        {
          key: 'es_ES-carlfm-x_low',
          name: 'Carlfm',
          language: 'Spanish (Spain)',
          quality: 'x_low',
        },
      ]
      const voice = selectPiperVoiceForLanguage('de', nonEnglishVoices)
      expect(voice).toBe('es_ES-carlfm-x_low')
    })

    it('should handle full language names', () => {
      const voice = selectPiperVoiceForLanguage('English', mockVoices)
      expect(voice).toBe('en_US-hfc_female-medium')
    })
  })

  describe('getKokoroVoicesForLanguage', () => {
    it('should return American and British voices for "en"', () => {
      const voices = getKokoroVoicesForLanguage('en')
      expect(voices.length).toBeGreaterThan(0)
      expect(voices).toContain('af_heart')
      expect(voices).toContain('bf_emma')
    })

    it('should return only American voices for "en-US"', () => {
      const voices = getKokoroVoicesForLanguage('en-US')
      expect(voices).toContain('af_heart')
      expect(voices).toContain('am_adam')
      expect(voices).not.toContain('bf_emma')
    })

    it('should return only British voices for "en-GB"', () => {
      const voices = getKokoroVoicesForLanguage('en-GB')
      expect(voices).toContain('bf_emma')
      expect(voices).not.toContain('af_heart')
    })

    it('should fallback to all English voices for unsupported language', () => {
      const voices = getKokoroVoicesForLanguage('es')
      expect(voices.length).toBeGreaterThan(0)
      expect(voices).toContain('af_heart')
    })
  })

  describe('getPiperVoicesForLanguage', () => {
    const mockVoices: PiperVoice[] = [
      {
        key: 'en_US-hfc_female-medium',
        name: 'HFC Female',
        language: 'English (US)',
        quality: 'medium',
      },
      { key: 'en_GB-alan-medium', name: 'Alan', language: 'English (GB)', quality: 'medium' },
      { key: 'es_ES-carlfm-x_low', name: 'Carlfm', language: 'Spanish (Spain)', quality: 'x_low' },
    ]

    it('should return English voices for "en"', () => {
      const voices = getPiperVoicesForLanguage('en', mockVoices)
      expect(voices.length).toBe(2)
      expect(voices.map((v) => v.key)).toContain('en_US-hfc_female-medium')
      expect(voices.map((v) => v.key)).toContain('en_GB-alan-medium')
    })

    it('should return Spanish voices for "es"', () => {
      const voices = getPiperVoicesForLanguage('es', mockVoices)
      expect(voices.length).toBe(1)
      expect(voices[0].key).toBe('es_ES-carlfm-x_low')
    })

    it('should return empty array for unsupported language', () => {
      const voices = getPiperVoicesForLanguage('de', mockVoices)
      expect(voices.length).toBe(0)
    })
  })
})
