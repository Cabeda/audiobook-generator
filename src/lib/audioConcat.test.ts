import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  concatenateAudioChapters,
  downloadAudioFile,
  createChapterMarkers,
  type AudioChapter,
  resampleAndNormalizeAudioBuffers,
} from './audioConcat.ts'

// Mock AudioContext for testing
class MockAudioContext {
  sampleRate = 44100

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (_channel: number) => new Float32Array(length),
    }
    return buffer as AudioBuffer
  }

  decodeAudioData(arrayBuffer: ArrayBuffer) {
    // Create a simple mock buffer
    const length = Math.floor(arrayBuffer.byteLength / 4) // Assume 16-bit stereo
    return Promise.resolve(this.createBuffer(2, length, this.sampleRate))
  }

  async close() {
    // Mock close
  }
}

describe('audioConcat', () => {
  beforeAll(() => {
    // Mock AudioContext globally
    ;(globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
      MockAudioContext

    // Add arrayBuffer method to Blob prototype if not present
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function () {
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

  describe('concatenateAudioChapters', () => {
    it('should return single chapter if only one provided', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob(['mock audio data'], { type: 'audio/wav' }),
        },
      ]

      const result = await concatenateAudioChapters(chapters)
      expect(result).toBe(chapters[0].blob)
    })

    it('should throw error if no chapters provided', async () => {
      await expect(concatenateAudioChapters([])).rejects.toThrow('No chapters to concatenate')
    })

    it('should concatenate multiple chapters', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      const result = await concatenateAudioChapters(chapters)

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
      expect(result.size).toBeGreaterThan(0)
    })

    it('should call progress callback during concatenation', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      const progressUpdates: string[] = []

      await concatenateAudioChapters(chapters, {}, (progress) => {
        progressUpdates.push(progress.status)
      })

      expect(progressUpdates).toContain('loading')
      expect(progressUpdates).toContain('decoding')
      expect(progressUpdates).toContain('concatenating')
      expect(progressUpdates).toContain('encoding')
      expect(progressUpdates).toContain('complete')
    })

    it.skip('should support MP3 format', async () => {
      // Skip: lamejs has issues in test environment
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      const result = await concatenateAudioChapters(chapters, { format: 'mp3', bitrate: 192 })

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mpeg')
    })

    it.skip('should support M4B format', async () => {
      // Skip: lamejs has issues in test environment
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      const result = await concatenateAudioChapters(chapters, { format: 'm4b', bitrate: 256 })

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/m4b')
    })

    it('should support WAV format by default', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      const result = await concatenateAudioChapters(chapters, { format: 'wav' })

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should resample and normalize differing sample rates and channel counts', async () => {
      const mockContext = new MockAudioContext()

      // Create a 1-second mono buffer at 22050
      const mono22050 = mockContext.createBuffer(1, 22050, 22050)
      // Create a 1-second stereo buffer at 44100
      const stereo44100 = mockContext.createBuffer(2, 44100, 44100)

      const normalized = resampleAndNormalizeAudioBuffers(mockContext as unknown as AudioContext, [
        mono22050,
        stereo44100,
      ])

      expect(normalized.length).toBe(2)
      // Both should be at the target (mock) sample rate
      expect(normalized[0].sampleRate).toBe(mockContext.sampleRate)
      expect(normalized[1].sampleRate).toBe(mockContext.sampleRate)
      // Both should have the same number of channels (max of inputs i.e. 2)
      expect(normalized[0].numberOfChannels).toBe(2)
      expect(normalized[1].numberOfChannels).toBe(2)
      // Verify lengths: mono22050 should have doubled length after resampling to 44100
      expect(normalized[0].length).toBe(Math.round(22050 * (mockContext.sampleRate / 22050)))
      expect(normalized[1].length).toBe(44100)
    })
  })

  describe('createChapterMarkers', () => {
    it('should create chapter markers with timestamps', () => {
      const mockContext = new MockAudioContext()
      const chapters: AudioChapter[] = [
        { id: 'ch1', title: 'Introduction', blob: new Blob() },
        { id: 'ch2', title: 'Main Content', blob: new Blob() },
      ]

      const audioBuffers = [
        mockContext.createBuffer(2, 44100, 44100), // 1 second
        mockContext.createBuffer(2, 88200, 44100), // 2 seconds
      ]

      const markers = createChapterMarkers(chapters, audioBuffers)

      expect(markers).toContain('CHAPTER01=00:00:00.000')
      expect(markers).toContain('CHAPTER01NAME=Introduction')
      expect(markers).toContain('CHAPTER02=00:00:01.000')
      expect(markers).toContain('CHAPTER02NAME=Main Content')
    })

    it('should handle multiple chapters with correct timing', () => {
      const mockContext = new MockAudioContext()
      const chapters: AudioChapter[] = [
        { id: 'ch1', title: 'Chapter 1', blob: new Blob() },
        { id: 'ch2', title: 'Chapter 2', blob: new Blob() },
        { id: 'ch3', title: 'Chapter 3', blob: new Blob() },
      ]

      const audioBuffers = [
        mockContext.createBuffer(2, 44100, 44100), // 1 second
        mockContext.createBuffer(2, 132300, 44100), // 3 seconds
        mockContext.createBuffer(2, 88200, 44100), // 2 seconds
      ]

      const markers = createChapterMarkers(chapters, audioBuffers)

      expect(markers).toContain('CHAPTER01=00:00:00.000')
      expect(markers).toContain('CHAPTER02=00:00:01.000')
      expect(markers).toContain('CHAPTER03=00:00:04.000')
    })
  })

  describe('downloadAudioFile', () => {
    it('should create download link and trigger download', () => {
      const blob = new Blob(['test data'], { type: 'audio/wav' })
      const filename = 'test-audiobook.wav'

      // Mock DOM methods
      const mockClick = vi.fn()
      const mockAppendChild = vi.fn()
      const mockRemoveChild = vi.fn()
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
      const mockRevokeObjectURL = vi.fn()

      globalThis.URL.createObjectURL = mockCreateObjectURL
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL

      const mockElement = {
        href: '',
        download: '',
        click: mockClick,
      }

      vi.spyOn(document, 'createElement').mockReturnValue(mockElement as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild)
      vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild)

      downloadAudioFile(blob, filename)

      expect(mockCreateObjectURL).toHaveBeenCalledWith(blob)
      expect(mockElement.download).toBe(filename)
      expect(mockClick).toHaveBeenCalled()
      expect(mockAppendChild).toHaveBeenCalled()
      expect(mockRemoveChild).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalled()
    })
  })
})
