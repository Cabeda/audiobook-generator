import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateVoice, listVoices, splitTextIntoChunks, type VoiceId } from './kokoroClient.ts'

// Mock kokoro-js to avoid loading the actual model in tests
vi.mock('kokoro-js', () => {
  const mockAudio = {
    toBlob: () => new Blob(['mock audio data'], { type: 'audio/wav' }),
  }

  const mockTTS = {
    generate: vi.fn().mockResolvedValue(mockAudio),
    stream: vi.fn().mockImplementation(async function* () {
      yield {
        text: 'Hello world',
        phonemes: 'həlˈoʊ wˈɜːld',
        audio: mockAudio,
      }
    }),
    list_voices: vi.fn(),
    voices: {},
  }

  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue(mockTTS),
    },
  }
})

describe('kokoroClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listVoices', () => {
    it('should return array of voice IDs', () => {
      const voices = listVoices()

      expect(Array.isArray(voices)).toBe(true)
      expect(voices.length).toBeGreaterThan(0)
      expect(voices).toContain('af_heart')
      expect(voices).toContain('af_bella')
      expect(voices).toContain('bm_george')
    })

    it('should return valid VoiceId types', () => {
      const voices = listVoices()

      // Verify all returned voices are valid VoiceId types
      const validVoices: VoiceId[] = [
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
        'bf_emma',
        'bf_isabella',
        'bm_george',
        'bm_lewis',
        'bf_alice',
        'bf_lily',
        'bm_daniel',
        'bm_fable',
      ]

      voices.forEach((voice: VoiceId) => {
        expect(validVoices).toContain(voice)
      })
    })
  })

  describe('generateVoice', () => {
    it('should generate audio blob from text', async () => {
      const result = await generateVoice({
        text: 'Hello world',
      })

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should use default voice when not specified', async () => {
      const result = await generateVoice({
        text: 'Test text',
      })

      // Verify result is valid
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should accept custom voice parameter', async () => {
      const result = await generateVoice({
        text: 'Hello with custom voice',
        voice: 'af_bella',
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should accept speed parameter', async () => {
      const result = await generateVoice({
        text: 'Fast speech',
        speed: 1.5,
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle empty text', async () => {
      const result = await generateVoice({
        text: '',
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle long text', async () => {
      const longText = 'This is a longer piece of text. '.repeat(10)
      const result = await generateVoice({
        text: longText,
      })

      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle special characters', async () => {
      const result = await generateVoice({
        text: "Hello! How are you? I'm fine, thanks. $100 is a lot.",
      })

      expect(result).toBeInstanceOf(Blob)
    })
  })

  describe('splitTextIntoChunks', () => {
    it('should return original text in array if shorter than max chunk size', () => {
      const text = 'This is a short text.'
      const chunks = splitTextIntoChunks(text, 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe(text)
    })

    it('should split long text into multiple chunks', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.'.repeat(10)
      const chunks = splitTextIntoChunks(text, 100)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it('should not lose any text during chunking', () => {
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

    it('should preserve all characters from original text', () => {
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

    it('should respect sentence boundaries', () => {
      const text =
        'This is sentence one. This is sentence two. This is sentence three. This is sentence four.'
      const chunks = splitTextIntoChunks(text, 50)

      // Each chunk should end with sentence-ending punctuation or be the last chunk
      chunks.forEach((chunk, index) => {
        if (index < chunks.length - 1) {
          // Not the last chunk - should end with punctuation
          const lastChar = chunk.trim().slice(-1)
          expect(['.', '!', '?']).toContain(lastChar)
        }
      })
    })

    it('should handle text with various punctuation', () => {
      const text =
        'Question one? Answer one! Statement one. Question two? Answer two! Statement two.'
      const chunks = splitTextIntoChunks(text, 40)

      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))
    })

    it('should handle text without sentence-ending punctuation', () => {
      const text = 'This is a text without proper punctuation marks at the end'
      const chunks = splitTextIntoChunks(text, 30)

      expect(chunks.length).toBeGreaterThanOrEqual(1)

      // Verify no text is lost
      const reconstructed = chunks.join(' ')
      expect(reconstructed.trim()).toBe(text.trim())
    })

    it('should handle very long single sentence', () => {
      // A sentence longer than the max chunk size
      const longSentence = 'This is a very long sentence that goes on and on. '.repeat(20)
      const chunks = splitTextIntoChunks(longSentence, 100)

      expect(chunks.length).toBeGreaterThan(1)

      // Verify no text is lost
      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(longSentence))
    })

    it('should handle empty text', () => {
      const chunks = splitTextIntoChunks('', 1000)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toBe('')
    })

    it('should handle text with only whitespace', () => {
      const chunks = splitTextIntoChunks('   \n\t  ', 1000)

      // Should return the original text (even if just whitespace)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it('should not create empty chunks', () => {
      const text = 'First. Second. Third. Fourth. Fifth. Sixth. Seventh. Eighth.'
      const chunks = splitTextIntoChunks(text, 20)

      // No chunk should be empty after trimming
      chunks.forEach((chunk) => {
        expect(chunk.trim().length).toBeGreaterThan(0)
      })
    })

    it('should handle text with multiple consecutive periods', () => {
      const text = 'First sentence... Second sentence... Third sentence...'
      const chunks = splitTextIntoChunks(text, 30)

      const reconstructed = chunks.join(' ')
      const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim()

      expect(normalizeWhitespace(reconstructed)).toBe(normalizeWhitespace(text))
    })

    it('should maintain word count across chunks', () => {
      const text =
        'One two three four. Five six seven eight. Nine ten eleven twelve. ' +
        'Thirteen fourteen fifteen sixteen. Seventeen eighteen nineteen twenty.'
      const chunks = splitTextIntoChunks(text, 40)

      // Count words in original
      const originalWords = text.match(/\b\w+\b/g) || []

      // Count words in all chunks combined
      const chunkedWords = chunks.flatMap((chunk) => chunk.match(/\b\w+\b/g) || [])

      expect(chunkedWords.length).toBe(originalWords.length)
    })

    it('should respect max chunk size constraint', () => {
      const text = 'This is sentence one. This is sentence two. This is sentence three.'.repeat(5)
      const maxSize = 150
      const chunks = splitTextIntoChunks(text, maxSize)

      // Each chunk should not exceed maxSize (with reasonable tolerance for sentence boundaries)
      chunks.forEach((chunk) => {
        // Allow chunks to be slightly over if a single sentence is longer than maxSize
        // but generally they should respect the limit
        if (chunk.length > maxSize) {
          // If over, it should be because it's a single sentence that couldn't be split
          const sentences = chunk.match(/[^.!?]+[.!?]+/g) || []
          expect(sentences.length).toBe(1)
        }
      })
    })

    it('should handle real-world book excerpt', () => {
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
      chunks.forEach((chunk) => {
        expect(chunk.trim().length).toBeGreaterThan(0)
      })
    })
  })
})
