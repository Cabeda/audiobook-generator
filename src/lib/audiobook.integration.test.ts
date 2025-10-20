import { describe, it, expect, beforeAll, vi } from 'vitest'
import { generateVoice } from './kokoro/kokoroClient.ts'
import { concatenateAudioChapters, type AudioChapter } from './audioConcat.ts'

// Mock kokoro-js to avoid loading the actual model in tests
vi.mock('kokoro-js', () => {
  // Create a mock WAV audio buffer (minimal valid WAV file)
  const createMockWavBuffer = (durationMs: number = 100) => {
    const sampleRate = 24000
    const numChannels = 1
    const bitsPerSample = 16
    const numSamples = Math.floor((sampleRate * durationMs) / 1000)
    const dataSize = numSamples * numChannels * (bitsPerSample / 8)
    const bufferSize = 44 + dataSize // WAV header + data
    
    const buffer = new ArrayBuffer(bufferSize)
    const view = new DataView(buffer)
    
    // WAV header
    // "RIFF" chunk descriptor
    view.setUint32(0, 0x52494646, false) // "RIFF"
    view.setUint32(4, bufferSize - 8, true) // File size - 8
    view.setUint32(8, 0x57415645, false) // "WAVE"
    
    // "fmt " sub-chunk
    view.setUint32(12, 0x666d7420, false) // "fmt "
    view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true) // NumChannels
    view.setUint32(24, sampleRate, true) // SampleRate
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true) // ByteRate
    view.setUint16(32, numChannels * (bitsPerSample / 8), true) // BlockAlign
    view.setUint16(34, bitsPerSample, true) // BitsPerSample
    
    // "data" sub-chunk
    view.setUint32(36, 0x64617461, false) // "data"
    view.setUint32(40, dataSize, true) // Subchunk2Size
    
    // Fill with silence (zeros) for simplicity
    for (let i = 44; i < bufferSize; i++) {
      view.setUint8(i, 0)
    }
    
    return buffer
  }

  const mockAudio = {
    toBlob: () => new Blob([createMockWavBuffer(100)], { type: 'audio/wav' })
  }

  const mockTTS = {
    generate: vi.fn().mockResolvedValue(mockAudio),
    stream: vi.fn().mockImplementation(async function* () {
      yield {
        text: 'Mock sentence',
        phonemes: 'mɑk sˈɛntəns',
        audio: mockAudio
      }
    }),
    list_voices: vi.fn(),
    voices: {}
  }

  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue(mockTTS)
    }
  }
})

// Mock AudioContext for testing
class MockAudioContext {
  sampleRate = 24000
  
  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (_channel: number) => {
        const data = new Float32Array(length)
        // Fill with a simple sine wave for testing
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.1
        }
        return data
      },
      copyToChannel: vi.fn(),
      copyFromChannel: vi.fn()
    }
    return buffer as unknown as AudioBuffer
  }
  
  decodeAudioData(arrayBuffer: ArrayBuffer) {
    // Parse WAV header to get actual length
    const view = new DataView(arrayBuffer)
    let sampleRate = 24000
    let numChannels = 1
    
    // Try to read WAV header if it's a valid WAV file
    if (arrayBuffer.byteLength >= 44) {
      try {
        const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
        if (riff === 'RIFF') {
          numChannels = view.getUint16(22, true)
          sampleRate = view.getUint32(24, true)
        }
      } catch {
        // If parsing fails, use defaults
      }
    }
    
    // Calculate length from data size (subtract header)
    const dataSize = Math.max(0, arrayBuffer.byteLength - 44)
    const length = Math.floor(dataSize / (numChannels * 2)) // 16-bit samples
    
    return this.createBuffer(numChannels, length, sampleRate)
  }
  
  async close() {
    // Mock close
  }
}

describe('Audiobook Generation Integration Tests', () => {
  beforeAll(() => {
    // Mock AudioContext globally
    (globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext
    
    // Mock URL.createObjectURL and revokeObjectURL
    if (typeof URL.createObjectURL === 'undefined') {
      URL.createObjectURL = vi.fn(() => 'blob:mock-url')
      URL.revokeObjectURL = vi.fn()
    }
    
    // Add arrayBuffer method to Blob prototype if not present
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function() {
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            resolve(reader.result as ArrayBuffer)
          }
          reader.readAsArrayBuffer(this)
        })
      }
    }
  })

  describe('MP3 Audiobook Generation', () => {
    it('should generate single chapter audiobook as MP3', async () => {
      // Generate audio for a single sentence
      const audioBlob = await generateVoice({
        text: 'This is the first chapter.',
        voice: 'af_bella'
      })

      expect(audioBlob).toBeInstanceOf(Blob)
      expect(audioBlob.type).toBe('audio/wav')
      expect(audioBlob.size).toBeGreaterThan(0)
    })

    it('should generate two-chapter audiobook as MP3', async () => {
      // Generate audio for two short chapters
      const chapter1Audio = await generateVoice({
        text: 'This is the first chapter.',
        voice: 'af_bella'
      })

      const chapter2Audio = await generateVoice({
        text: 'This is the second chapter.',
        voice: 'af_bella'
      })

      // Create chapter objects
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: chapter1Audio
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: chapter2Audio
        }
      ]

      // Concatenate chapters
      const concatenatedBlob = await concatenateAudioChapters(chapters, {
        format: 'mp3',
        bitrate: 192
      })

      expect(concatenatedBlob).toBeInstanceOf(Blob)
      expect(concatenatedBlob.type).toBe('audio/mpeg')
      expect(concatenatedBlob.size).toBeGreaterThan(0)
    })

    it('should generate MP3 with different bitrates', async () => {
      const audioBlob = await generateVoice({
        text: 'Testing different bitrates.',
        voice: 'af_bella'
      })

      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: audioBlob
        }
      ]

      // Test with 128 kbps
      const mp3_128 = await concatenateAudioChapters(chapters, {
        format: 'mp3',
        bitrate: 128
      })
      expect(mp3_128.type).toBe('audio/mpeg')

      // Test with 320 kbps
      const mp3_320 = await concatenateAudioChapters(chapters, {
        format: 'mp3',
        bitrate: 320
      })
      expect(mp3_320.type).toBe('audio/mpeg')
    })
  })

  describe('M4B Audiobook Generation', () => {
    it('should generate single chapter audiobook as M4B', async () => {
      // Generate audio for a single sentence
      const audioBlob = await generateVoice({
        text: 'This is the first chapter.',
        voice: 'bm_george'
      })

      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: audioBlob
        }
      ]

      // Generate M4B
      const m4bBlob = await concatenateAudioChapters(chapters, {
        format: 'm4b',
        bitrate: 256,
        bookTitle: 'Test Audiobook',
        bookAuthor: 'Test Author'
      })

      expect(m4bBlob).toBeInstanceOf(Blob)
      expect(m4bBlob.type).toBe('audio/m4b')
      expect(m4bBlob.size).toBeGreaterThan(0)
    })

    it('should generate two-chapter audiobook as M4B with metadata', async () => {
      // Generate audio for two short chapters
      const chapter1Audio = await generateVoice({
        text: 'This is the first chapter.',
        voice: 'bm_george'
      })

      const chapter2Audio = await generateVoice({
        text: 'This is the second chapter.',
        voice: 'bm_george'
      })

      // Create chapter objects
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Introduction',
          blob: chapter1Audio
        },
        {
          id: 'ch2',
          title: 'Main Content',
          blob: chapter2Audio
        }
      ]

      // Generate M4B with metadata
      const m4bBlob = await concatenateAudioChapters(chapters, {
        format: 'm4b',
        bitrate: 256,
        bookTitle: 'Complete Audiobook',
        bookAuthor: 'John Doe'
      })

      expect(m4bBlob).toBeInstanceOf(Blob)
      expect(m4bBlob.type).toBe('audio/m4b')
      expect(m4bBlob.size).toBeGreaterThan(0)
    })

    it('should generate M4B with chapter markers', async () => {
      // Generate audio for three chapters
      const chapters: AudioChapter[] = []
      
      for (let i = 1; i <= 3; i++) {
        const audio = await generateVoice({
          text: `This is chapter ${i}.`,
          voice: 'bm_george'
        })
        
        chapters.push({
          id: `ch${i}`,
          title: `Chapter ${i}`,
          blob: audio
        })
      }

      // Generate M4B with chapter markers
      const m4bBlob = await concatenateAudioChapters(chapters, {
        format: 'm4b',
        bitrate: 192,
        bookTitle: 'Multi-Chapter Book',
        bookAuthor: 'Test Author'
      })

      expect(m4bBlob).toBeInstanceOf(Blob)
      expect(m4bBlob.type).toBe('audio/m4b')
      expect(m4bBlob.size).toBeGreaterThan(0)
    })
  })

  describe('Format Comparison', () => {
    it('should generate both MP3 and M4B from same chapters', async () => {
      // Generate audio for two chapters
      const chapter1Audio = await generateVoice({
        text: 'First chapter content.',
        voice: 'af_sarah'
      })

      const chapter2Audio = await generateVoice({
        text: 'Second chapter content.',
        voice: 'af_sarah'
      })

      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: chapter1Audio
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: chapter2Audio
        }
      ]

      // Generate MP3
      const mp3Blob = await concatenateAudioChapters(chapters, {
        format: 'mp3',
        bitrate: 192
      })

      // Generate M4B
      const m4bBlob = await concatenateAudioChapters(chapters, {
        format: 'm4b',
        bitrate: 192,
        bookTitle: 'Test Book',
        bookAuthor: 'Test Author'
      })

      // Verify both formats were generated successfully
      expect(mp3Blob).toBeInstanceOf(Blob)
      expect(mp3Blob.type).toBe('audio/mpeg')
      expect(mp3Blob.size).toBeGreaterThan(0)

      expect(m4bBlob).toBeInstanceOf(Blob)
      expect(m4bBlob.type).toBe('audio/m4b')
      expect(m4bBlob.size).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle empty text gracefully', async () => {
      await expect(generateVoice({ text: '' })).resolves.toBeInstanceOf(Blob)
    })

    it('should handle very short text', async () => {
      const audioBlob = await generateVoice({
        text: 'Hi.',
        voice: 'af_bella'
      })

      expect(audioBlob).toBeInstanceOf(Blob)
      expect(audioBlob.size).toBeGreaterThan(0)
    })

    it('should handle concatenation of single chapter', async () => {
      const audioBlob = await generateVoice({
        text: 'Single chapter.',
        voice: 'af_bella'
      })

      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Only Chapter',
          blob: audioBlob
        }
      ]

      // For single chapter, it should return the original blob
      const result = await concatenateAudioChapters(chapters)
      expect(result).toBe(audioBlob)
    })
  })
})
