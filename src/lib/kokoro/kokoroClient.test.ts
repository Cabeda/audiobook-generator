import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { VoiceId } from './kokoroClient'
import {
  createDefaultKokoroMock,
  createJSHandleKokoroMock,
} from '../../../test/factories/kokoroMock'
// We'll dynamically import kokoroClient's exports within tests to ensure per-test
// mocking of 'kokoro-js' is applied before the module loads.

// The kokoro-js module will be mocked per-test using vi.doMock. To avoid leaking
// mocks between tests, reset modules and re-setup a default mock before every test.
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  // Setup default kokoro mock for tests
  vi.doMock('kokoro-js', () => createDefaultKokoroMock())
})

afterEach(() => {
  // Ensure module registry is reset after each test to avoid caching across tests
  vi.resetModules()
  vi.clearAllMocks()
})

describe('kokoroClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listVoices', () => {
    it('should return array of voice IDs', async () => {
      const { listVoices } = await import('./kokoroClient.ts')
      const voices = listVoices()

      expect(Array.isArray(voices)).toBe(true)
      expect(voices.length).toBeGreaterThan(0)
      expect(voices).toContain('af_heart')
      expect(voices).toContain('af_bella')
      expect(voices).toContain('bm_george')
    })

    it('should return valid VoiceId types', async () => {
      const { listVoices } = await import('./kokoroClient.ts')
      const voices = listVoices()

      // Verify all returned voices are valid VoiceId types
      const validVoices: VoiceId[] = [
        // American English
        'af_heart',
        'af_alloy',
        'af_aoede',
        'af_bella',
        'af_jessica',
        'af_kore',
        'af_nicole',
        'af_nova',
        'af_river',
        'af_sarah',
        'af_sky',
        'am_adam',
        'am_echo',
        'am_eric',
        'am_liam',
        'am_michael',
        'am_onyx',
        'am_puck',
        'am_santa',
        // British English
        'bf_emma',
        'bf_isabella',
        'bf_alice',
        'bf_lily',
        'bm_george',
        'bm_lewis',
        'bm_daniel',
        'bm_fable',
        // Japanese
        'jf_alpha',
        'jf_gongitsune',
        'jf_nezumi',
        'jf_tebukuro',
        'jm_kumo',
        'jm_beta',
        // Chinese (Mandarin)
        'zf_xiaobei',
        'zf_xiaoni',
        'zf_xiaoxiao',
        'zf_xiaoyi',
        'zm_yunjian',
        'zm_yunxi',
        'zm_yunxia',
        'zm_yunyang',
        // Spanish
        'ef_dora',
        'em_alex',
        'em_santa',
        // French
        'ff_siwis',
        // Hindi
        'hf_alpha',
        'hf_beta',
        'hm_omega',
        'hm_psi',
        // Italian
        'if_sara',
        'im_nicola',
        // Brazilian Portuguese
        'pf_dora',
        'pm_alex',
        'pm_santa',
      ]

      voices.forEach((voice: VoiceId) => {
        expect(validVoices).toContain(voice)
      })
    })
  })

  describe('generateVoice', () => {
    it('should generate audio blob from text', async () => {
      // Import module after mocking to ensure the module uses the mocked kokoro-js
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({ text: 'Hello world' })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should use default voice when not specified', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({ text: 'Test text' })

      // Verify result is valid
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should accept custom voice parameter', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({ text: 'Hello with custom voice', voice: 'af_bella' })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should accept speed parameter', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({ text: 'Fast speech', speed: 1.5 })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle empty text', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({ text: '' })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle long text', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const longText = 'This is a longer piece of text. '.repeat(10)
      const result = await generateVoice({ text: longText })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle special characters', async () => {
      const { generateVoice } = await import('./kokoroClient.ts')
      const result = await generateVoice({
        text: "Hello! How are you? I'm fine, thanks. $100 is a lot.",
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should warn when toBlob returns a non-Blob JSHandle-like object', async () => {
      // Use per-test mock to return a JSHandle-like value
      vi.doMock('kokoro-js', () => createJSHandleKokoroMock())

      // Re-import the module after setting the per-test mock
      const { generateVoice } = await import('./kokoroClient.ts')
      // Spy on logger.warn to assert our detection logs
      const logger = await import('../utils/logger')
      const warnSpy = vi.spyOn(logger.default, 'warn').mockImplementation(() => {})

      // The per-test mock `createJSHandleKokoroMock()` will provide the JSHandle-like
      // values used to trigger strict handling in `generateVoice`. We re-import the
      // module after mocking to ensure the mock is applied.

      try {
        await expect(
          generateVoice({ text: 'This is a long text that should go streaming' as string })
        ).rejects.toThrow()
      } finally {
        expect(warnSpy).toHaveBeenCalled()
        warnSpy.mockRestore()
        // Restore original kokoro mock for other tests
        vi.doUnmock('kokoro-js')
        vi.resetModules()
      }
    })
  })

  describe('splitTextIntoChunks', () => {
    it('should return original text in array if shorter than max chunk size', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'This is a short text.'
      const chunks = splitTextIntoChunks(text, 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })

    it('should split long text into multiple chunks', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.'.repeat(10)
      const chunks = splitTextIntoChunks(text, 100)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should not lose any text during chunking', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'This is the first sentence. This is the second sentence. This is the third sentence. ' +
        'This is the fourth sentence. This is the fifth sentence. This is the sixth sentence.'
      const chunks = splitTextIntoChunks(text, 80)

      // Reconstruct text from chunks (accounting for trimmed whitespace)
      const reconstructed = chunks.join(' ')

      // Normalize whitespace for comparison
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))
    })

    it('should preserve all characters from original text', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'Hello world! How are you? I am fine. What about you? Great weather today. ' +
        'Let us go for a walk. That sounds wonderful. See you soon!'
      const chunks = splitTextIntoChunks(text, 50)

      // Account for spaces added between sentences during chunking
      // The original text length should be close to the reconstructed length
      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed).length).toBe(normalizeWhitespace(text).length)
    })

    it('should respect sentence boundaries', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'This is sentence one. This is sentence two. This is sentence three. This is sentence four.'
      const chunks = splitTextIntoChunks(text, 50)

      // Each chunk should end with sentence-ending punctuation or be the last chunk
      chunks.forEach((chunk: string, index: number) => {
        if (index < chunks.length - 1) {
          // Not the last chunk - should end with punctuation
          const lastChar = chunk.trim().slice(-1)
          expect(['.', '!', '?']).toContain(lastChar)
        }
      })
    })

    it('should handle text with various punctuation', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'Question one? Answer one! Statement one. Question two? Answer two! Statement two.'
      const chunks = splitTextIntoChunks(text, 40)

      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))
    })

    it('should handle text without sentence-ending punctuation', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'This is a text without proper punctuation marks at the end'
      const chunks = splitTextIntoChunks(text, 30)

      expect(chunks.length).toBeGreaterThanOrEqual(1)

      // Verify no text is lost
      const reconstructed = chunks.join(' ')
      expect(reconstructed.trim()).toBe(text.trim())
    })

    it('should handle very long single sentence', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      // A sentence longer than the max chunk size
      const longSentence = 'This is a very long sentence that goes on and on. '.repeat(20)
      const chunks = splitTextIntoChunks(longSentence, 100)

      expect(chunks.length).toBeGreaterThan(1)

      // Verify no text is lost
      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(longSentence))
    })

    it('should handle empty text', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const chunks = splitTextIntoChunks('', 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe('')
    })

    it('should handle text with only whitespace', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const chunks = splitTextIntoChunks('   \n\t  ', 1000)

      // Should return the original text (even if just whitespace)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it('should not create empty chunks', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'First. Second. Third. Fourth. Fifth. Sixth. Seventh. Eighth.'
      const chunks = splitTextIntoChunks(text, 20)

      // No chunk should be empty after trimming
      chunks.forEach((chunk: string) => {
        expect(chunk.trim().length).toBeGreaterThan(0)
      })
    })

    it('should handle text with multiple consecutive periods', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'First sentence... Second sentence... Third sentence...'
      const chunks = splitTextIntoChunks(text, 30)

      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))
    })

    it('should maintain word count across chunks', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'One two three four. Five six seven eight. Nine ten eleven twelve. ' +
        'Thirteen fourteen fifteen sixteen. Seventeen eighteen nineteen twenty.'
      const chunks = splitTextIntoChunks(text, 40)

      // Count words in original
      const originalWords = text.match(/\b\w+\b/g) || []

      // Count words in all chunks combined
      const chunkedWords = chunks.flatMap((chunk: string) => chunk.match(/\b\w+\b/g) || [])

      expect(chunkedWords.length).toBe(originalWords.length)
    })

    it('should respect max chunk size constraint', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'This is sentence one. This is sentence two. This is sentence three.'.repeat(5)
      const maxSize = 150
      const chunks = splitTextIntoChunks(text, maxSize)

      // Each chunk should not exceed maxSize (with reasonable tolerance for sentence boundaries)
      chunks.forEach((chunk: string) => {
        // Allow chunks to be slightly over if a single sentence is longer than maxSize
        // but generally they should respect the limit
        if (chunk.length > maxSize) {
          // If over, it should be because it's a single sentence that couldn't be split
          const sentences = chunk.match(/[^.!?]+[.!?]+/g) || []
          expect(sentences.length).toBe(1)
        }
      })
    })

    it('should handle real-world book excerpt', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text =
        'It was the best of times, it was the worst of times. It was the age of wisdom, it was the age of foolishness. ' +
        'It was the epoch of belief, it was the epoch of incredulity. It was the season of Light, it was the season of Darkness. ' +
        'It was the spring of hope, it was the winter of despair.'
      const chunks = splitTextIntoChunks(text, 100)

      // Verify no text is lost
      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))

      // Verify we got multiple chunks
      expect(chunks.length).toBeGreaterThan(1)

      // Verify each chunk is non-empty
      chunks.forEach((chunk: string) => {
        expect(chunk.trim().length).toBeGreaterThan(0)
      })
    })
  })

  describe('MIN_TEXT_LENGTH filtering', () => {
    it('should filter out segments shorter than MIN_TEXT_LENGTH (3 chars)', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      // Text with very short segments mixed with valid text
      const text = 'Valid sentence here. 1. Another valid sentence. 2. Final valid text.'
      const chunks = splitTextIntoChunks(text, 1000)

      // All chunks should be >= 3 characters
      chunks.forEach((chunk: string) => {
        expect(chunk.trim().length).toBeGreaterThanOrEqual(3)
      })

      // Should have filtered out the "1." and "2." segments
      expect(chunks.some((c: string) => c.trim() === '1.')).toBe(false)
      expect(chunks.some((c: string) => c.trim() === '2.')).toBe(false)
    })

    it('should return original text when all segments are too short', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      // Text with only very short segments
      const text = '1. 2. 3.'
      const chunks = splitTextIntoChunks(text, 1000)

      // Should return the original text as fallback when all segments are filtered
      // (splitTextIntoChunks returns [text] when chunks.length === 0)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })

    it('should handle mixed short and long segments correctly', async () => {
      const { splitTextIntoChunks } = await import('./kokoroClient.ts')
      const text = 'This is valid. 1. Another sentence. 2. 3. Final.'
      const chunks = splitTextIntoChunks(text, 50)

      // All returned chunks should be >= 3 characters
      chunks.forEach((chunk: string) => {
        expect(chunk.trim().length).toBeGreaterThanOrEqual(3)
      })

      // Should have filtered out short segments
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.some((c: string) => c.trim().length < 3)).toBe(false)
    })
  })

  describe('generateVoiceSegments with MIN_TEXT_LENGTH', () => {
    it('should return silent audio for text shorter than MIN_TEXT_LENGTH', async () => {
      const { generateVoiceSegments } = await import('./kokoroClient.ts')

      // Very short text
      const result = await generateVoiceSegments({
        text: '1.',
        voice: 'af_heart',
      })

      // Should return a result with silent audio
      expect(result).toHaveLength(1)
      expect(result[0].blob).toBeInstanceOf(Blob)
      expect(result[0].blob.type).toBe('audio/wav')
      expect(result[0].text).toBe('1.') // Text should be preserved
    })

    it('should return silent audio when all chunks are filtered out', async () => {
      const { generateVoiceSegments } = await import('./kokoroClient.ts')

      // Long text but all segments are too short
      const longShortText = '1. 2. 3. 4. 5. 6. 7. 8. 9. 0. a. b. c. d. e. f. g. h. i. j.'
      const result = await generateVoiceSegments({
        text: longShortText,
        voice: 'af_heart',
      })

      // Should return a result with silent audio
      expect(result).toHaveLength(1)
      expect(result[0].blob).toBeInstanceOf(Blob)
      expect(result[0].blob.type).toBe('audio/wav')
      expect(result[0].text).toBe(longShortText) // Original text should be preserved
    })

    it('should generate audio for valid text with short segments filtered', async () => {
      const { generateVoiceSegments } = await import('./kokoroClient.ts')

      // Mix of valid and short segments
      const text = 'This is a valid sentence. 1. Another valid sentence.'
      const result = await generateVoiceSegments({
        text: text,
        voice: 'af_heart',
      })

      // Should successfully generate audio segments
      expect(result.length).toBeGreaterThan(0)
      result.forEach((segment) => {
        expect(segment.blob).toBeInstanceOf(Blob)
        expect(segment.blob.type).toBe('audio/wav')
        expect(segment.text).toBeTruthy()
      })
    })
  })
})
