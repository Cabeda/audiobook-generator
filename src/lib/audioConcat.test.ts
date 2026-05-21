import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  concatenateAudioChapters,
  downloadAudioFile,
  createChapterMarkers,
  type AudioChapter,
  resampleAndNormalizeAudioBuffers,
  audioLikeToBlob,
  convertWavToMp3,
  audioBufferToMp3,
} from './audioConcat.ts'

// Mock mediabunnyEncoder so tests don't require WebCodecs
vi.mock('./mediabunnyEncoder', () => ({
  convertWavToMp3: vi.fn(
    async (blob: Blob) => new Blob([await blob.arrayBuffer()], { type: 'audio/mpeg' })
  ),
  convertWavToM4b: vi.fn(
    async (blob: Blob) => new Blob([await blob.arrayBuffer()], { type: 'audio/m4b' })
  ),
}))

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

// Helper to safely cast MockAudioContext for testing purposes
function toAudioContext(ctx: MockAudioContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext
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

    it('should produce an output WAV whose length equals the sum of input lengths', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(4000)], { type: 'audio/wav' }),
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: new Blob([new ArrayBuffer(8000)], { type: 'audio/wav' }),
        },
      ]

      // Decode each original chunk to determine expected total length
      const audioCtx = new (
        globalThis as unknown as { AudioContext: typeof MockAudioContext }
      ).AudioContext()
      const decodedBuffers: AudioBuffer[] = []
      for (const c of chapters) {
        const array = await c.blob.arrayBuffer()
        const db = await audioCtx.decodeAudioData(array)
        decodedBuffers.push(db)
      }

      const expectedLength = decodedBuffers.reduce((s, b) => s + b.length, 0)

      // Concatenate using the function under test
      const result = await concatenateAudioChapters(chapters, { format: 'wav' })
      const outArray = await result.arrayBuffer()
      const outBuf = await audioCtx.decodeAudioData(outArray)

      // Allow a small tolerance due to resampling / channel mixing that may slightly alter lengths
      const diff = Math.abs(outBuf.length - expectedLength)
      expect(diff).toBeLessThanOrEqual(16)
      expect(outBuf.numberOfChannels).toBe(decodedBuffers[0].numberOfChannels)
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

      const normalized = resampleAndNormalizeAudioBuffers(toAudioContext(mockContext), [
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

    it('should work when only OfflineAudioContext is available (worker fallback)', async () => {
      // Create a mock offline audio context constructor that accepts (channels, length, sampleRate)
      class MockOfflineAudioContext {
        sampleRate = 44100
        constructor(
          public _channels = 2,
          public _length = 1,
          sampleRate = 44100
        ) {
          this.sampleRate = sampleRate
        }
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
          const length = Math.floor(arrayBuffer.byteLength / 4)
          return Promise.resolve(this.createBuffer(2, length, this.sampleRate))
        }
      }

      // Remove global AudioContext and use Offline fallback
      ;(globalThis as unknown as { AudioContext?: any }).AudioContext = undefined
      ;(globalThis as unknown as { OfflineAudioContext?: any }).OfflineAudioContext =
        MockOfflineAudioContext as any

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

      // Restore mocked AudioContext for other tests
      ;(globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
        MockAudioContext
      delete (globalThis as unknown as { OfflineAudioContext?: any }).OfflineAudioContext
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

  describe('audioBufferToMp3 metadata handling', () => {
    it.skip('should be tested in E2E (requires WebCodecs/Mediabunny)', () => {
      // MP3/M4B encoding now uses Mediabunny which requires WebCodecs (browser-only).
      // Encoding tests have been moved to E2E Playwright specs.
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

  describe('Edge Cases: PCM Length and Sample Rate Verification', () => {
    it('should concatenate 3 chapters and verify length equals sum', async () => {
      const mockContext = new MockAudioContext()

      // Create 3 chapters with different lengths
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Chapter 1',
          blob: new Blob([new ArrayBuffer(4000)], { type: 'audio/wav' }),
        },
        {
          id: 'ch2',
          title: 'Chapter 2',
          blob: new Blob([new ArrayBuffer(8000)], { type: 'audio/wav' }),
        },
        {
          id: 'ch3',
          title: 'Chapter 3',
          blob: new Blob([new ArrayBuffer(6000)], { type: 'audio/wav' }),
        },
      ]

      // Decode each original chunk to determine expected total length
      const decodedBuffers: AudioBuffer[] = []
      for (const c of chapters) {
        const array = await c.blob.arrayBuffer()
        const db = await mockContext.decodeAudioData(array)
        decodedBuffers.push(db)
      }

      const expectedLength = decodedBuffers.reduce((s, b) => s + b.length, 0)

      // Concatenate using the function under test
      const result = await concatenateAudioChapters(chapters, { format: 'wav' })
      const outArray = await result.arrayBuffer()
      const outBuf = await mockContext.decodeAudioData(outArray)

      // Allow a small tolerance due to resampling / channel mixing
      const diff = Math.abs(outBuf.length - expectedLength)
      expect(diff).toBeLessThanOrEqual(16)
      expect(outBuf.numberOfChannels).toBe(decodedBuffers[0].numberOfChannels)
    })

    it('should handle input blobs with different sample rates through resampling', async () => {
      const mockContext = new MockAudioContext()

      // Create buffers with different sample rates
      const buffer22k = mockContext.createBuffer(1, 22050, 22050)
      const buffer44k = mockContext.createBuffer(1, 44100, 44100)
      const buffer16k = mockContext.createBuffer(1, 16000, 16000)

      const buffers = [buffer22k, buffer44k, buffer16k]

      // Use resampleAndNormalizeAudioBuffers to verify resampling
      const normalized = resampleAndNormalizeAudioBuffers(toAudioContext(mockContext), buffers)

      // All buffers should be resampled to the target sample rate
      expect(normalized[0].sampleRate).toBe(mockContext.sampleRate)
      expect(normalized[1].sampleRate).toBe(mockContext.sampleRate)
      expect(normalized[2].sampleRate).toBe(mockContext.sampleRate)

      // Verify lengths are adjusted proportionally
      expect(normalized[0].length).toBe(Math.round(22050 * (mockContext.sampleRate / 22050)))
      expect(normalized[1].length).toBe(44100)
      expect(normalized[2].length).toBe(Math.round(16000 * (mockContext.sampleRate / 16000)))
    })
  })

  describe('Edge Cases: Channel Count Mismatch', () => {
    it('should normalize stereo and mono channels correctly', () => {
      const mockContext = new MockAudioContext()

      // Create mono and stereo buffers
      const monoBuffer = mockContext.createBuffer(1, 44100, 44100)
      const stereoBuffer = mockContext.createBuffer(2, 44100, 44100)

      const normalized = resampleAndNormalizeAudioBuffers(toAudioContext(mockContext), [
        monoBuffer,
        stereoBuffer,
      ])

      // Both should be normalized to max channels (2)
      expect(normalized[0].numberOfChannels).toBe(2)
      expect(normalized[1].numberOfChannels).toBe(2)
      expect(normalized[0].length).toBe(44100)
      expect(normalized[1].length).toBe(44100)
    })

    it('should keep all mono buffers as mono', () => {
      const mockContext = new MockAudioContext()

      const mono1 = mockContext.createBuffer(1, 44100, 44100)
      const mono2 = mockContext.createBuffer(1, 44100, 44100)

      const normalized = resampleAndNormalizeAudioBuffers(toAudioContext(mockContext), [
        mono1,
        mono2,
      ])

      // Should remain mono since all inputs are mono
      expect(normalized[0].numberOfChannels).toBe(1)
      expect(normalized[1].numberOfChannels).toBe(1)
    })

    it('should keep all stereo buffers as stereo', () => {
      const mockContext = new MockAudioContext()

      const stereo1 = mockContext.createBuffer(2, 44100, 44100)
      const stereo2 = mockContext.createBuffer(2, 44100, 44100)

      const normalized = resampleAndNormalizeAudioBuffers(toAudioContext(mockContext), [
        stereo1,
        stereo2,
      ])

      expect(normalized[0].numberOfChannels).toBe(2)
      expect(normalized[1].numberOfChannels).toBe(2)
    })
  })

  describe('Edge Cases: Missing AudioContext', () => {
    it('should produce clear error when Web Audio API is unavailable and fallbacks fail', async () => {
      // Save current contexts
      const savedAudioContext = (globalThis as any).AudioContext
      const savedOfflineAudioContext = (globalThis as any).OfflineAudioContext
      const savedWebkitAudioContext = (globalThis as any).webkitAudioContext

      try {
        // Remove all audio contexts
        delete (globalThis as any).AudioContext
        delete (globalThis as any).OfflineAudioContext
        delete (globalThis as any).webkitAudioContext
        delete (globalThis as any).webkitOfflineAudioContext

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

        // Should either succeed with WAV-only fallback or throw clear error
        try {
          const result = await concatenateAudioChapters(chapters, { format: 'wav' })
          // If it succeeds, verify it's a valid blob
          expect(result).toBeInstanceOf(Blob)
          expect(result.type).toBe('audio/wav')
        } catch (err) {
          // If it fails, verify error message is clear
          expect(err).toBeInstanceOf(Error)
          expect((err as Error).message).toMatch(
            /Web Audio API not available|cannot concatenate audio|OfflineAudioContext is not available/
          )
        }
      } finally {
        // Restore contexts
        ;(globalThis as any).AudioContext = savedAudioContext
        ;(globalThis as any).OfflineAudioContext = savedOfflineAudioContext
        ;(globalThis as any).webkitAudioContext = savedWebkitAudioContext
      }
    })

    it('should use OfflineAudioContext fallback when AudioContext is missing', async () => {
      const savedAudioContext = (globalThis as any).AudioContext

      // Mock OfflineAudioContext
      class TestOfflineAudioContext {
        sampleRate = 44100
        constructor(_channels: number, _length: number, sampleRate: number) {
          this.sampleRate = sampleRate
        }
        createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
          return {
            numberOfChannels,
            length,
            sampleRate,
            duration: length / sampleRate,
            getChannelData: (_channel: number) => new Float32Array(length),
          } as AudioBuffer
        }
        decodeAudioData(arrayBuffer: ArrayBuffer) {
          const length = Math.floor(arrayBuffer.byteLength / 4)
          return Promise.resolve(this.createBuffer(2, length, this.sampleRate))
        }
      }

      try {
        delete (globalThis as any).AudioContext
        ;(globalThis as any).OfflineAudioContext = TestOfflineAudioContext

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
      } finally {
        ;(globalThis as any).AudioContext = savedAudioContext
        delete (globalThis as any).OfflineAudioContext
      }
    })
  })

  describe('Edge Cases: Empty and Invalid Input', () => {
    it('should throw clear error for empty chapters array', async () => {
      await expect(concatenateAudioChapters([])).rejects.toThrow('No chapters to concatenate')
    })

    it('should handle chapters with empty blobs gracefully', async () => {
      const chapters: AudioChapter[] = [
        {
          id: 'ch1',
          title: 'Empty Chapter',
          blob: new Blob([], { type: 'audio/wav' }),
        },
        {
          id: 'ch2',
          title: 'Valid Chapter',
          blob: new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' }),
        },
      ]

      // Should insert silence for empty chapters instead of failing
      const result = await concatenateAudioChapters(chapters, { format: 'wav' })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    }, 15000)
  })

  describe('audioLikeToBlob', () => {
    it('should return Blob as-is', async () => {
      const blob = new Blob(['test'], { type: 'audio/wav' })
      const result = await audioLikeToBlob(blob)
      expect(result).toBe(blob)
    })

    it('should convert ArrayBuffer to Blob', async () => {
      const buf = new ArrayBuffer(10)
      const result = await audioLikeToBlob(buf)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should convert Uint8Array to Blob', async () => {
      const arr = new Uint8Array([1, 2, 3])
      const result = await audioLikeToBlob(arr)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should throw for null/undefined', async () => {
      await expect(audioLikeToBlob(null)).rejects.toThrow('No audio provided')
      await expect(audioLikeToBlob(undefined)).rejects.toThrow('No audio provided')
    })

    it('should throw for unsupported types', async () => {
      await expect(audioLikeToBlob(42)).rejects.toThrow('Unsupported audio type')
    })

    it('should handle objects with arrayBuffer method', async () => {
      const obj = {
        arrayBuffer: async () => new ArrayBuffer(8),
        type: 'audio/mp3',
      }
      const result = await audioLikeToBlob(obj)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mp3')
    })

    it('should handle objects with arrayBuffer method and no type', async () => {
      const obj = {
        arrayBuffer: async () => new ArrayBuffer(8),
      }
      const result = await audioLikeToBlob(obj)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should handle objects with failing arrayBuffer method and fall through', async () => {
      const obj = {
        arrayBuffer: async () => {
          throw new Error('fail')
        },
      }
      await expect(audioLikeToBlob(obj)).rejects.toThrow('Unsupported audio type')
    })

    it('should handle AudioBuffer-like objects', async () => {
      const mockAudioBuffer = {
        numberOfChannels: 1,
        sampleRate: 44100,
        length: 100,
        duration: 100 / 44100,
        getChannelData: () => new Float32Array(100),
      }
      const result = await audioLikeToBlob(mockAudioBuffer)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/wav')
    })

    it('should resolve Promise-like objects', async () => {
      const promise = Promise.resolve(new Blob(['data'], { type: 'audio/wav' }))
      const result = await audioLikeToBlob(promise)
      expect(result).toBeInstanceOf(Blob)
    })

    it('should handle objects already in seen set gracefully', async () => {
      // The seen set check is wrapped in try/catch for exotic objects,
      // so circular refs fall through to "unsupported type" error
      const obj: any = {}
      const seen = new WeakSet()
      seen.add(obj)
      await expect(audioLikeToBlob(obj, seen)).rejects.toThrow('Unsupported audio type')
    })

    it('should throw on excessive depth', async () => {
      await expect(audioLikeToBlob({ something: true }, new WeakSet(), 13)).rejects.toThrow(
        'Exceeded maximum audio wrapper unwrapping depth'
      )
    })

    it('should handle JSHandle-like wrapper with value property', async () => {
      class JSHandleWrapper {
        value = new Blob(['data'], { type: 'audio/wav' })
      }
      const handle = new JSHandleWrapper()
      const result = await audioLikeToBlob(handle)
      expect(result).toBeInstanceOf(Blob)
    })

    it('should throw for JSHandle-like wrapper with error state', async () => {
      class JSHandleMock {
        toString() {
          return 'JSHandle@error'
        }
        get [Symbol.toStringTag]() {
          return 'JSHandle'
        }
      }
      // Override constructor name
      Object.defineProperty(JSHandleMock, 'name', { value: 'JSHandle' })
      const handle = new JSHandleMock()
      await expect(audioLikeToBlob(handle)).rejects.toThrow('JSHandle reported an error')
    })

    it('should throw for unresolvable JSHandle-like wrapper', async () => {
      class JSHandleWrapper {
        value = null
        json = null
      }
      Object.defineProperty(JSHandleWrapper, 'name', { value: 'JSHandle' })
      const handle = new JSHandleWrapper()
      await expect(audioLikeToBlob(handle)).rejects.toThrow('Unsupported JSHandle-like wrapper')
    })

    it('should resolve Promise that wraps a Blob', async () => {
      const blob = new Blob(['audio'], { type: 'audio/wav' })
      const promise = Promise.resolve(blob)
      const result = await audioLikeToBlob(promise)
      expect(result).toBe(blob)
    })

    it('should handle failing Promise gracefully', async () => {
      const promise = Promise.reject(new Error('network error'))
      await expect(audioLikeToBlob(promise)).rejects.toThrow('Unsupported audio type')
    })
  })

  describe('convertWavToMp3', () => {
    it('should convert WAV blob to MP3 via mediabunny', async () => {
      const wavBlob = new Blob([new ArrayBuffer(100)], { type: 'audio/wav' })
      const result = await convertWavToMp3(wavBlob, 192)
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mpeg')
    })
  })

  describe('audioBufferToMp3', () => {
    it('should convert AudioBuffer to MP3', async () => {
      const audioCtx = new (
        globalThis as unknown as { AudioContext: typeof MockAudioContext }
      ).AudioContext()
      const audioBuffer = audioCtx.createBuffer(1, 44100, 44100)
      const chapters: AudioChapter[] = [{ id: 'ch1', title: 'Test', blob: new Blob() }]

      const result = await audioBufferToMp3(audioBuffer, 192, chapters, { format: 'mp3' })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mpeg')
    })

    it('should convert AudioBuffer to M4B when format is m4b', async () => {
      const audioCtx = new (
        globalThis as unknown as { AudioContext: typeof MockAudioContext }
      ).AudioContext()
      const audioBuffer = audioCtx.createBuffer(1, 44100, 44100)
      const chapters: AudioChapter[] = [{ id: 'ch1', title: 'Test', blob: new Blob() }]

      const result = await audioBufferToMp3(audioBuffer, 192, chapters, { format: 'm4b' })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/m4b')
    })
  })

  describe('concatenateAudioChapters with encoding formats', () => {
    it('should encode to MP3 format', async () => {
      // Create valid WAV blobs
      const wavHeader = new ArrayBuffer(44)
      const view = new DataView(wavHeader)
      // RIFF header
      new Uint8Array(wavHeader).set([0x52, 0x49, 0x46, 0x46]) // RIFF
      view.setUint32(4, 36 + 100, true) // file size
      new Uint8Array(wavHeader).set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
      new Uint8Array(wavHeader).set([0x66, 0x6d, 0x74, 0x20], 12) // fmt
      view.setUint32(16, 16, true) // chunk size
      view.setUint16(20, 1, true) // PCM
      view.setUint16(22, 1, true) // mono
      view.setUint32(24, 44100, true) // sample rate
      view.setUint32(28, 88200, true) // byte rate
      view.setUint16(32, 2, true) // block align
      view.setUint16(34, 16, true) // bits per sample
      new Uint8Array(wavHeader).set([0x64, 0x61, 0x74, 0x61], 36) // data
      view.setUint32(40, 100, true) // data size

      const wavData = new Uint8Array(144)
      wavData.set(new Uint8Array(wavHeader))

      const chapters: AudioChapter[] = [
        { id: 'ch1', title: 'Chapter 1', blob: new Blob([wavData], { type: 'audio/wav' }) },
        { id: 'ch2', title: 'Chapter 2', blob: new Blob([wavData], { type: 'audio/wav' }) },
      ]

      const result = await concatenateAudioChapters(chapters, { format: 'mp3', bitrate: 192 })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mpeg')
    })

    it('should encode to M4B format', async () => {
      const wavHeader = new ArrayBuffer(44)
      const view = new DataView(wavHeader)
      new Uint8Array(wavHeader).set([0x52, 0x49, 0x46, 0x46])
      view.setUint32(4, 36 + 100, true)
      new Uint8Array(wavHeader).set([0x57, 0x41, 0x56, 0x45], 8)
      new Uint8Array(wavHeader).set([0x66, 0x6d, 0x74, 0x20], 12)
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 44100, true)
      view.setUint32(28, 88200, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      new Uint8Array(wavHeader).set([0x64, 0x61, 0x74, 0x61], 36)
      view.setUint32(40, 100, true)

      const wavData = new Uint8Array(144)
      wavData.set(new Uint8Array(wavHeader))

      const chapters: AudioChapter[] = [
        { id: 'ch1', title: 'Chapter 1', blob: new Blob([wavData], { type: 'audio/wav' }) },
      ]

      const result = await concatenateAudioChapters(chapters, { format: 'm4b' })
      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/m4b')
    })

    it('should report progress during encoding', async () => {
      const wavHeader = new ArrayBuffer(44)
      const view = new DataView(wavHeader)
      new Uint8Array(wavHeader).set([0x52, 0x49, 0x46, 0x46])
      view.setUint32(4, 36 + 100, true)
      new Uint8Array(wavHeader).set([0x57, 0x41, 0x56, 0x45], 8)
      new Uint8Array(wavHeader).set([0x66, 0x6d, 0x74, 0x20], 12)
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 44100, true)
      view.setUint32(28, 88200, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      new Uint8Array(wavHeader).set([0x64, 0x61, 0x74, 0x61], 36)
      view.setUint32(40, 100, true)

      const wavData = new Uint8Array(144)
      wavData.set(new Uint8Array(wavHeader))

      const chapters: AudioChapter[] = [
        { id: 'ch1', title: 'Chapter 1', blob: new Blob([wavData], { type: 'audio/wav' }) },
      ]

      const progressUpdates: string[] = []
      await concatenateAudioChapters(chapters, { format: 'mp3' }, (p) => {
        progressUpdates.push(p.status)
      })

      expect(progressUpdates).toContain('concatenating')
      expect(progressUpdates).toContain('encoding')
      expect(progressUpdates).toContain('complete')
    })
  })
})
