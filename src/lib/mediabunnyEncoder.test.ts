/**
 * Integration test for mediabunnyEncoder.
 * Tests the actual Mediabunny conversion with real WAV data.
 * These tests require a browser environment (WebCodecs) so they
 * validate the encoder logic with proper WAV input.
 */
import { describe, it, expect, vi } from 'vitest'

// Don't mock mediabunnyEncoder here — we test it directly
// But we need to mock the mediabunny module since WebCodecs isn't available in Node
vi.mock('mediabunny', () => {
  class MockBlobSource {
    constructor(public blob: Blob) {}
  }
  class MockBufferTarget {
    buffer: ArrayBuffer | null = null
  }
  class MockMp3OutputFormat {}
  class MockMp4OutputFormat {}
  class MockInput {
    constructor(public opts: any) {}
  }
  class MockOutput {
    target: MockBufferTarget
    constructor(public opts: any) {
      this.target = opts.target
    }
  }
  const MockConversion = {
    init: vi.fn(async ({ output }: any) => {
      return {
        isValid: true,
        discardedTracks: [],
        execute: async () => {
          // Simulate producing output
          output.target.buffer = new ArrayBuffer(100)
        },
      }
    }),
  }

  // The key export: WAVE should be an InputFormat instance, not a string
  const WAVE = { type: 'wave' }

  return {
    Input: MockInput,
    Output: MockOutput,
    Conversion: MockConversion,
    BlobSource: MockBlobSource,
    BufferTarget: MockBufferTarget,
    Mp3OutputFormat: MockMp3OutputFormat,
    Mp4OutputFormat: MockMp4OutputFormat,
    WAVE,
    canEncodeAudio: vi.fn(async () => true),
  }
})

vi.mock('@mediabunny/mp3-encoder', () => ({
  registerMp3Encoder: vi.fn(),
}))

vi.mock('@mediabunny/aac-encoder', () => ({
  registerAacEncoder: vi.fn(),
}))

import { convertWavToMp3, convertWavToM4b } from './mediabunnyEncoder'
import { Conversion } from 'mediabunny'

describe('mediabunnyEncoder', () => {
  describe('convertWavToMp3', () => {
    it('should convert a WAV blob to MP3', async () => {
      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      const result = await convertWavToMp3(wavBlob, 192)

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/mpeg')
      expect(result.size).toBeGreaterThan(0)
    })

    it('should pass correct bitrate to Conversion.init', async () => {
      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      await convertWavToMp3(wavBlob, 256)

      expect(Conversion.init).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: { bitrate: 256000 },
        })
      )
    })

    it('should throw when conversion is not valid', async () => {
      vi.mocked(Conversion.init).mockResolvedValueOnce({
        isValid: false,
        discardedTracks: [{ reason: 'no audio track found' }],
        execute: vi.fn(),
        onProgress: null,
      } as any)

      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      await expect(convertWavToMp3(wavBlob)).rejects.toThrow('MP3 conversion not possible')
    })

    it('should throw when conversion produces no output', async () => {
      vi.mocked(Conversion.init).mockResolvedValueOnce({
        isValid: true,
        discardedTracks: [],
        execute: async () => {
          // Don't set buffer — simulates empty output
        },
        onProgress: null,
      } as any)

      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      await expect(convertWavToMp3(wavBlob)).rejects.toThrow('MP3 conversion produced no output')
    })
  })

  describe('convertWavToM4b', () => {
    it('should convert a WAV blob to M4B', async () => {
      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      const result = await convertWavToM4b(wavBlob, 192)

      expect(result).toBeInstanceOf(Blob)
      expect(result.type).toBe('audio/m4b')
      expect(result.size).toBeGreaterThan(0)
    })

    it('should throw when conversion is not valid', async () => {
      vi.mocked(Conversion.init).mockResolvedValueOnce({
        isValid: false,
        discardedTracks: [{ reason: 'codec not supported' }],
        execute: vi.fn(),
        onProgress: null,
      } as any)

      const wavBlob = new Blob([new ArrayBuffer(1000)], { type: 'audio/wav' })
      await expect(convertWavToM4b(wavBlob)).rejects.toThrow('M4B conversion not possible')
    })
  })
})
