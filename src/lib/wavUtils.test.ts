/**
 * Tests for the WAV module (src/lib/wavUtils.ts).
 *
 * The WAV module owns header parsing, duration derivation and concatenation.
 * Everything that touches WAV bytes goes through it.
 */
import { describe, it, expect } from 'vitest'
import { parseWavDuration, parseWavHeaderFromBlob, concatWavBlobs } from './wavUtils'

const encoder = new TextEncoder()

/**
 * Build a WAV blob. `extraChunk` inserts a chunk before `data`, so the header
 * is longer than the canonical 44 bytes.
 */
function createWav(
  sampleRate: number,
  durationMs: number,
  options: { channels?: number; extraChunk?: string } = {}
): Blob {
  const channels = options.channels ?? 1
  const bytesPerSample = 2
  const numSamples = Math.floor((sampleRate * durationMs) / 1000)
  const dataLength = numSamples * channels * bytesPerSample

  const extraBody = options.extraChunk
    ? encoder.encode(options.extraChunk.slice(4))
    : new Uint8Array(0)
  const extraSize = options.extraChunk ? 8 + extraBody.length + (extraBody.length % 2) : 0

  const headerLength = 44 + extraSize
  const buffer = new ArrayBuffer(headerLength + dataLength)
  const view = new DataView(buffer)

  new Uint8Array(buffer, 0, 4).set(encoder.encode('RIFF'))
  view.setUint32(4, 36 + extraSize + dataLength, true)
  new Uint8Array(buffer, 8, 4).set(encoder.encode('WAVE'))
  new Uint8Array(buffer, 12, 4).set(encoder.encode('fmt '))
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true)

  let dataOffset = 36
  if (options.extraChunk) {
    const id = options.extraChunk.slice(0, 4)
    new Uint8Array(buffer, 36, 4).set(encoder.encode(id))
    view.setUint32(40, extraBody.length, true)
    new Uint8Array(buffer, 44).set(extraBody)
    dataOffset = 36 + extraSize
  }

  new Uint8Array(buffer, dataOffset, 4).set(encoder.encode('data'))
  view.setUint32(dataOffset + 4, dataLength, true)

  return new Blob([buffer], { type: 'audio/wav' })
}

describe('parseWavDuration', () => {
  it('returns the duration of a canonical WAV', async () => {
    const blob = createWav(24000, 1000)
    expect(await parseWavDuration(blob)).toBeCloseTo(1, 3)
  })

  it('finds the data chunk when the header is longer than 44 bytes', async () => {
    const blob = createWav(24000, 1000, { extraChunk: 'LISTINFO' })
    expect(await parseWavDuration(blob)).toBeCloseTo(1, 3)
  })

  it('falls back to a size estimate for data that is not a RIFF/WAVE', async () => {
    const notWav = new Blob([new Uint8Array(48044)], { type: 'audio/mpeg' })
    expect(await parseWavDuration(notWav)).toBeCloseTo(1, 3)
  })

  it('returns 0 for an empty blob instead of a negative duration', async () => {
    expect(await parseWavDuration(new Blob([]))).toBe(0)
  })
})

describe('parseWavHeaderFromBlob', () => {
  it('reports the format and data region', async () => {
    const info = await parseWavHeaderFromBlob(createWav(44100, 500, { channels: 2 }))
    expect(info.fmt.sampleRate).toBe(44100)
    expect(info.fmt.numChannels).toBe(2)
    expect(info.dataLength).toBe(44100 * 0.5 * 2 * 2)
  })

  it('throws for a non-RIFF blob', async () => {
    await expect(parseWavHeaderFromBlob(new Blob([new Uint8Array(64)]))).rejects.toThrow('RIFF')
  })
})

describe('concatWavBlobs', () => {
  it('concatenates the audio data of each blob', async () => {
    const a = createWav(24000, 1000)
    const b = createWav(24000, 500)

    const result = await concatWavBlobs([a, b])

    const info = await parseWavHeaderFromBlob(result)
    expect(info.fmt.sampleRate).toBe(24000)
    expect(info.dataLength).toBe(24000 * 1.5 * 2)
    expect(await parseWavDuration(result)).toBeCloseTo(1.5, 3)
  })

  it('concatenates blobs whose headers are not 44 bytes long', async () => {
    const a = createWav(24000, 1000, { extraChunk: 'LISTINFO' })
    const b = createWav(24000, 1000, { extraChunk: 'LISTINFO' })

    const result = await concatWavBlobs([a, b])

    const info = await parseWavHeaderFromBlob(result)
    expect(info.dataLength).toBe(24000 * 2 * 2)
  })

  it('rejects blobs with different formats', async () => {
    await expect(concatWavBlobs([createWav(24000, 100), createWav(44100, 100)])).rejects.toThrow(
      /format mismatch/i
    )
  })

  it('rejects an empty list', async () => {
    await expect(concatWavBlobs([])).rejects.toThrow('No chapters')
  })
})
