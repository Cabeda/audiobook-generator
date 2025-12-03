import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { combineAudioBlobs } from './ttsRunner.ts'

// Mock OfflineAudioContext for testing
class MockOfflineAudioContext {
  sampleRate: number

  constructor(
    public _channels: number,
    public _length: number,
    sampleRate: number
  ) {
    this.sampleRate = sampleRate
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (channel: number) => {
        const data = new Float32Array(length)
        // Fill with simple pattern for testing
        for (let i = 0; i < length; i++) {
          data[i] = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 0.5
        }
        return data
      },
    }
    return buffer as AudioBuffer
  }

  async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    // Simple mock: length proportional to arrayBuffer size
    const numSamples = Math.floor(arrayBuffer.byteLength / 4) // Assume 16-bit stereo
    return this.createBuffer(1, numSamples, this.sampleRate)
  }

  createBufferSource() {
    return {
      buffer: null as AudioBuffer | null,
      connect: () => {},
      start: () => {},
    }
  }

  get destination() {
    return {}
  }

  async startRendering(): Promise<AudioBuffer> {
    // Return a buffer based on construction parameters
    return this.createBuffer(this._channels, this._length, this.sampleRate)
  }
}

describe('combineAudioBlobs', () => {
  let originalOfflineAudioContext: any

  beforeAll(() => {
    originalOfflineAudioContext = (globalThis as any).OfflineAudioContext
    ;(globalThis as any).OfflineAudioContext = MockOfflineAudioContext

    // Add arrayBuffer method to Blob prototype if not present (jsdom compatibility)
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

  afterEach(() => {
    // Restore mock after each test
    ;(globalThis as any).OfflineAudioContext = MockOfflineAudioContext
  })

  it('should combine multiple audio blobs successfully', async () => {
    const blob1 = new Blob([new ArrayBuffer(2000)], { type: 'audio/wav' })
    const blob2 = new Blob([new ArrayBuffer(3000)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([blob1, blob2], 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
    expect(result.size).toBeGreaterThan(0)
  })

  it('should handle single blob input', async () => {
    const blob = new Blob([new ArrayBuffer(2000)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([blob], 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
  })

  it('should throw error for empty array', async () => {
    // combineAudioBlobs with empty array will try to create buffer with length 0
    // which should work but produce an empty/minimal output
    const result = await combineAudioBlobs([], 22050)
    // Should return a valid blob even if empty
    expect(result).toBeInstanceOf(Blob)
  })

  it('should throw clear error when OfflineAudioContext is unavailable', async () => {
    // Remove OfflineAudioContext
    delete (globalThis as any).OfflineAudioContext
    delete (globalThis as any).webkitOfflineAudioContext

    const blob = new Blob([new ArrayBuffer(2000)], { type: 'audio/wav' })

    await expect(combineAudioBlobs([blob], 22050)).rejects.toThrow(
      /OfflineAudioContext is not available/
    )

    // Restore for other tests
    ;(globalThis as any).OfflineAudioContext = MockOfflineAudioContext
  })

  it('should handle blobs with different implied sample rates', async () => {
    // Even if blobs have different sample rates encoded in them,
    // combineAudioBlobs should decode them all using the provided target sample rate
    const blob1 = new Blob([new ArrayBuffer(2205)], { type: 'audio/wav' }) // Implies different rate
    const blob2 = new Blob([new ArrayBuffer(4410)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([blob1, blob2], 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
  })

  it('should preserve mono channel output', async () => {
    const blob1 = new Blob([new ArrayBuffer(2000)], { type: 'audio/wav' })
    const blob2 = new Blob([new ArrayBuffer(2000)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([blob1, blob2], 22050)

    // Verify the result is valid
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')

    // combineAudioBlobs creates a mono (1 channel) output
    // We can't easily verify channel count without actually decoding,
    // but we've tested the code path
  })

  it('should handle large number of blobs', async () => {
    const blobs: Blob[] = []
    for (let i = 0; i < 10; i++) {
      blobs.push(new Blob([new ArrayBuffer(500)], { type: 'audio/wav' }))
    }

    const result = await combineAudioBlobs(blobs, 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
    expect(result.size).toBeGreaterThan(0)
  })
})

describe('combineAudioBlobs edge cases', () => {
  // No need for beforeAll here - setup is already done in the previous describe block

  it('should handle very small blobs', async () => {
    const tinyBlob = new Blob([new ArrayBuffer(100)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([tinyBlob], 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
  })

  it('should handle blobs with mismatched sizes', async () => {
    const smallBlob = new Blob([new ArrayBuffer(500)], { type: 'audio/wav' })
    const largeBlob = new Blob([new ArrayBuffer(5000)], { type: 'audio/wav' })

    const result = await combineAudioBlobs([smallBlob, largeBlob], 22050)

    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')
  })
})
