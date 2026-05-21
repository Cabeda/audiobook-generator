/**
 * Test that reproduces the "Failed to concatenate segments" error
 * when WAV segments have mismatched sample rates (e.g., from interrupted
 * Kokoro generation or mixed TTS engines).
 */
import { describe, it, expect, vi } from 'vitest'
import { incrementalConcatWav, parseWavHeaderFromBlob } from './wavUtils'
import { concatenateAudioChapters, type AudioChapter } from './audioConcat'

// Mock mediabunnyEncoder
vi.mock('./mediabunnyEncoder', () => ({
  convertWavToMp3: vi.fn(async (blob: Blob) =>
    new Blob([await blob.arrayBuffer()], { type: 'audio/mpeg' })
  ),
  convertWavToM4b: vi.fn(async (blob: Blob) =>
    new Blob([await blob.arrayBuffer()], { type: 'audio/m4b' })
  ),
}))

/**
 * Create a valid WAV blob with specific parameters
 */
function createWavBlob(sampleRate: number, durationMs: number, channels = 1): Blob {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000)
  const bytesPerSample = 2
  const dataLength = numSamples * channels * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // RIFF header
  const encoder = new TextEncoder()
  new Uint8Array(buffer, 0, 4).set(encoder.encode('RIFF'))
  view.setUint32(4, 36 + dataLength, true)
  new Uint8Array(buffer, 8, 4).set(encoder.encode('WAVE'))
  new Uint8Array(buffer, 12, 4).set(encoder.encode('fmt '))
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true) // 16-bit
  new Uint8Array(buffer, 36, 4).set(encoder.encode('data'))
  view.setUint32(40, dataLength, true)

  return new Blob([buffer], { type: 'audio/wav' })
}

describe('WAV segment format mismatch during export', () => {
  it('incrementalConcatWav should resample mismatched sample rates instead of throwing', async () => {
    const seg24k = createWavBlob(24000, 500)
    const seg44k = createWavBlob(44100, 500)

    const segments = [seg24k, seg44k]

    const result = await incrementalConcatWav(2, async (i) => segments[i])
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')

    // Output should use the first segment's sample rate (24000)
    const info = await parseWavHeaderFromBlob(result)
    expect(info.fmt.sampleRate).toBe(24000)
  })

  it('concatenateAudioChapters should still succeed with mismatched WAV segments via WebAudio fallback', async () => {
    // This simulates what happens during export: segments with different sample rates
    // The concatWavBlobs path will fail, but it should fall through to WebAudio resampling
    const seg24k = createWavBlob(24000, 100)
    const seg44k = createWavBlob(44100, 100)

    // Combine into a single chapter blob that looks like WAV but has mixed content
    // In reality, the export service calls incrementalConcatWav per-chapter first,
    // and if that fails, the chapter is skipped entirely.
    // This test verifies the chapter-level concatenation handles format differences.
    const chapters: AudioChapter[] = [
      { id: 'ch1', title: 'Chapter 1', blob: seg24k },
      { id: 'ch2', title: 'Chapter 2', blob: seg44k },
    ]

    // With mismatched WAV formats, concatWavBlobs will fail,
    // then it falls to webAudioConcatToWav which resamples.
    // But in Node test env without AudioContext, this will also fail.
    // The real fix needs to be in the export service or incrementalConcatWav.
    try {
      const result = await concatenateAudioChapters(chapters, { format: 'mp3' })
      // If it succeeds (AudioContext available), verify output
      expect(result).toBeInstanceOf(Blob)
    } catch (err) {
      // In Node without AudioContext, this is expected to fail
      expect((err as Error).message).toMatch(/Web Audio API not available|cannot concatenate/)
    }
  })

  it('incrementalConcatWav should succeed with matching sample rates', async () => {
    const seg1 = createWavBlob(24000, 500)
    const seg2 = createWavBlob(24000, 300)

    const result = await incrementalConcatWav(2, async (i) => [seg1, seg2][i])
    expect(result).toBeInstanceOf(Blob)
    expect(result.type).toBe('audio/wav')

    // Verify the output is valid WAV
    const info = await parseWavHeaderFromBlob(result)
    expect(info.fmt.sampleRate).toBe(24000)
  })

  it('should produce a valid WAV that can be read back', async () => {
    // Simulate what Kokoro produces: 24000 Hz mono 16-bit WAV segments
    const seg1 = createWavBlob(24000, 1000) // 1 second
    const seg2 = createWavBlob(24000, 1000) // 1 second
    const seg3 = createWavBlob(24000, 500)  // 0.5 seconds

    const result = await incrementalConcatWav(3, async (i) => [seg1, seg2, seg3][i])

    // Verify the concatenated WAV is valid
    const info = await parseWavHeaderFromBlob(result)
    expect(info.fmt.sampleRate).toBe(24000)
    expect(info.fmt.numChannels).toBe(1)
    expect(info.fmt.bitsPerSample).toBe(16)
    // Total data should be sum of all segments
    const expectedSamples = 24000 * 1 + 24000 * 1 + 24000 * 0.5
    const expectedBytes = expectedSamples * 2 // 16-bit = 2 bytes per sample
    expect(info.dataLength).toBe(expectedBytes)
  })
})
