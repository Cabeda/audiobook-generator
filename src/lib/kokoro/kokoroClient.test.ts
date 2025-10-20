import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateVoice, listVoices, type VoiceId } from './kokoroClient.ts'

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
})
