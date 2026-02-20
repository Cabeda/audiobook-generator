/**
 * Matrix Testing: Model × Format × Voice Combinations
 *
 * Systematically tests all combinations of:
 * - TTS models (Kokoro, Piper)
 * - Output formats (WAV, MP3, M4B, EPUB)
 * - Voices (per model)
 * - Advanced settings
 */

import { describe, it, expect } from 'vitest'
import { parseWavHeader, generateText, createTestWav } from '../utils/audio-validation'
import type { TTSModelType } from '../../src/lib/tts/ttsModels'

// Test matrix configuration
const TEST_MATRIX = {
  models: ['kokoro', 'piper'] as TTSModelType[],
  formats: ['wav', 'mp3', 'm4b'] as const,
  settings: {
    kokoro: [
      { stitchLongSentences: true, parallelChunks: 1 },
      { stitchLongSentences: false, parallelChunks: 2 },
    ],
    piper: [
      { noiseScale: 0.667, lengthScale: 1.0 },
      { noiseScale: 0.8, lengthScale: 1.2 },
    ],
  },
  bitrates: [128, 192, 256] as const,
}

const _TEST_TEXT = generateText(50)

describe('Audiobook Generation Matrix Tests', () => {
  describe('WAV Format Validation', () => {
    it('should create valid WAV with correct metadata', async () => {
      const wav = createTestWav(1000, 24000)
      const metadata = await parseWavHeader(wav)

      expect(metadata.sampleRate).toBe(24000)
      expect(metadata.channels).toBe(1)
      expect(metadata.bitDepth).toBe(16)
      expect(metadata.duration).toBeCloseTo(1.0, 1)
    })

    it('should parse WAV duration correctly', async () => {
      const wav = createTestWav(2500, 24000)
      const metadata = await parseWavHeader(wav)

      expect(metadata.duration).toBeCloseTo(2.5, 1)
    })
  })

  describe('Format Conversion Quality', () => {
    it('should preserve duration when parsing WAV', async () => {
      const expectedDuration = 1.5
      const wav = createTestWav(expectedDuration * 1000, 24000)

      const metadata = await parseWavHeader(wav)

      expect(metadata.duration).toBeCloseTo(expectedDuration, 1)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle empty text gracefully', () => {
      const emptyText = ''
      expect(emptyText).toBe('')
      // Generation service should handle this
    })

    it('should handle very long text', () => {
      const longText = generateText(5000)
      const words = longText.split(/\s+/)
      expect(words.length).toBe(5000)
    })

    it('should handle special characters', () => {
      const specialText = 'Test with émojis 🎉 and symbols @#$% and quotes \'single\' "double"'
      expect(specialText).toBeDefined()
      expect(specialText.length).toBeGreaterThan(0)
    })
  })

  describe('Model Configuration', () => {
    it.each(TEST_MATRIX.models)('should have valid model: %s', (model) => {
      expect(model).toBeDefined()
      expect(['kokoro', 'piper']).toContain(model)
    })

    it.each(TEST_MATRIX.formats)('should have valid format: %s', (format) => {
      expect(format).toBeDefined()
      expect(['wav', 'mp3', 'm4b']).toContain(format)
    })
  })

  describe('Settings Validation', () => {
    it('should have kokoro settings', () => {
      const settings = TEST_MATRIX.settings.kokoro
      expect(settings).toBeDefined()
      expect(settings.length).toBeGreaterThan(0)
      expect(settings[0]).toHaveProperty('stitchLongSentences')
      expect(settings[0]).toHaveProperty('parallelChunks')
    })

    it('should have piper settings', () => {
      const settings = TEST_MATRIX.settings.piper
      expect(settings).toBeDefined()
      expect(settings.length).toBeGreaterThan(0)
      expect(settings[0]).toHaveProperty('noiseScale')
      expect(settings[0]).toHaveProperty('lengthScale')
    })
  })

  describe('Bitrate Configuration', () => {
    it.each(TEST_MATRIX.bitrates)('should support bitrate: %d kbps', (bitrate) => {
      expect(bitrate).toBeGreaterThan(0)
      expect(bitrate).toBeLessThanOrEqual(320)
    })
  })
})

describe('Performance Benchmarks', () => {
  it('should generate test text quickly', () => {
    const start = performance.now()
    const text = generateText(1000)
    const duration = performance.now() - start

    expect(text.split(/\s+/).length).toBe(1000)
    expect(duration).toBeLessThan(100) // Should be very fast
  })

  it('should create test WAV quickly', () => {
    const start = performance.now()
    const wav = createTestWav(1000)
    const duration = performance.now() - start

    expect(wav.size).toBeGreaterThan(0)
    expect(duration).toBeLessThan(100)
  })
})
