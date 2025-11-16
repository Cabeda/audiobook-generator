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
    it('should write metadata.txt and include -map_metadata 1 when generating M4B', async () => {
      // Mock @ffmpeg/ffmpeg so we can capture file write and run args
      const writtenFiles: Record<string, Uint8Array> = {}
      const runArgs: string[] = []

      class MockFFmpeg {
        fs: Record<string, Uint8Array> | undefined = {}
        listeners: Record<string, Array<(msg: any) => void>> = {}
        on(_event: string, cb: (m: unknown) => void) {
          this.listeners['log'] = this.listeners['log'] || []
          this.listeners['log'].push(cb)
        }
        async load() {}
        writeFile(name: string, data: Uint8Array) {
          writtenFiles[name] = data
        }
        exec(args: string[]) {
          runArgs.push(...args)
          const out = args[args.length - 1]
          this.fs = this.fs || {}
          this.fs[out] = new Uint8Array([1, 2, 3])
        }
        readFile(name: string) {
          return (this.fs && this.fs[name]) || new Uint8Array()
        }
        FS(op: 'writeFile' | 'readFile' | 'unlink' | 'remove', name: string, data?: Uint8Array) {
          if (op === 'writeFile') writtenFiles[name] = data as Uint8Array
          if (op === 'readFile') return this.fs[name]
        }
      }

      // Reset modules to ensure audioConcat will be re-imported with mocked ffmpeg
      vi.resetModules()
      // Do runtime module mock for FFmpeg (must be set before import)
      vi.doMock('@ffmpeg/ffmpeg', () => ({ FFmpeg: MockFFmpeg }))
      // Now import audioBufferToMp3 dynamically so it picks up the mocked FFmpeg
      const { audioBufferToMp3 } = await import('./audioConcat.ts')

      // Create a dummy AudioBuffer using the MockAudioContext
      const audioCtx = new (
        globalThis as unknown as { AudioContext: typeof MockAudioContext }
      ).AudioContext()
      const audioBuffer = audioCtx.createBuffer(2, 44100, 44100)

      const chapters = [
        { id: 'ch1', title: 'Intro', blob: new Blob(), duration: 1 },
        { id: 'ch2', title: 'Main', blob: new Blob(), duration: 2 },
      ]

      // Call audioBufferToMp3 with m4b (which triggers metadata creation)
      const m4b = await audioBufferToMp3(audioBuffer, 192, chapters as any, {
        format: 'm4b',
        bookTitle: 'Test Book',
        bookAuthor: 'Test Author',
      })

      // Assert that metadata.txt was written and '-map_metadata' included
      expect(Object.keys(writtenFiles)).toContain('metadata.txt')
      expect(runArgs.join(' ')).toContain('-map_metadata')
      // M4B Blob should be present
      expect(m4b).toBeInstanceOf(Blob)

      // Unmock FFmpeg so other tests are unaffected
      vi.doUnmock('@ffmpeg/ffmpeg')
      // Reset modules to clear our dynamic import mock state
      vi.resetModules()
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
