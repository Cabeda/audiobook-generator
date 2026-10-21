/**
 * WAV module.
 *
 * The single place that reads and writes WAV bytes: header parsing, duration
 * derivation and concatenation. Everything else asks this module instead of
 * walking chunk bytes itself.
 *
 * No FFmpeg dependency — these work with raw ArrayBuffers and Blobs.
 */

import logger from './utils/logger'

/** Size of a canonical 44-byte WAV header (RIFF + fmt + data). */
export const WAV_HEADER_BYTES = 44

export type WavFormat = {
  audioFormat: number
  numChannels: number
  sampleRate: number
  byteRate: number
  blockAlign: number
  bitsPerSample: number
}

export type WavHeader = { fmt: WavFormat; dataOffset: number; dataLength: number }

// ─── Low-level WAV helpers ───────────────────────────────────────────────────

/** Write an ASCII string into a DataView at the given byte offset. */
export function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/** Convert float samples to 16-bit PCM in a DataView. */
export function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}

/** Interleave channels from an AudioBuffer into a single Float32Array. */
export function interleave(audioBuffer: AudioBuffer): Float32Array {
  const numberOfChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length * numberOfChannels
  const result = new Float32Array(length)

  let offset = 0
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      result[offset++] = audioBuffer.getChannelData(channel)[i]
    }
  }

  return result
}

// ─── WAV creation / conversion ───────────────────────────────────────────────

/**
 * Build a canonical 44-byte WAV header for a data region of `dataLength` bytes.
 * Every writer in this module goes through here, so the header layout lives in
 * one place.
 */
export function buildWavHeader(fmt: WavFormat, dataLength: number): ArrayBuffer {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, fmt.audioFormat, true)
  view.setUint16(22, fmt.numChannels, true)
  view.setUint32(24, fmt.sampleRate, true)
  view.setUint32(28, fmt.byteRate, true)
  view.setUint16(32, fmt.blockAlign, true)
  view.setUint16(34, fmt.bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  return buffer
}

/** Convert an AudioBuffer to a 16-bit PCM WAV Blob. */
export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16

  const bytesPerSample = bitDepth / 8
  const blockAlign = numberOfChannels * bytesPerSample

  const data = interleave(audioBuffer)
  const dataLength = data.length * bytesPerSample
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength)
  const view = new DataView(buffer)

  new Uint8Array(buffer).set(
    new Uint8Array(
      buildWavHeader(
        {
          audioFormat: format,
          numChannels: numberOfChannels,
          sampleRate,
          byteRate: sampleRate * blockAlign,
          blockAlign,
          bitsPerSample: bitDepth,
        },
        dataLength
      )
    )
  )

  // Write audio data
  floatTo16BitPCM(view, WAV_HEADER_BYTES, data)

  return new Blob([buffer], { type: 'audio/wav' })
}

/** Create a silent WAV blob of specified duration. */
export function createSilentWav(durationSeconds: number = 1, sampleRate: number = 44100): Blob {
  const numChannels = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const totalSamples = sampleRate * durationSeconds
  const dataLength = totalSamples * numChannels * bytesPerSample

  const header = buildWavHeader(
    {
      audioFormat: 1, // PCM
      numChannels,
      sampleRate,
      byteRate: sampleRate * numChannels * bytesPerSample,
      blockAlign: numChannels * bytesPerSample,
      bitsPerSample: bitDepth,
    },
    dataLength
  )

  // Data is already 0 (silence) in a fresh ArrayBuffer
  return new Blob([header, new ArrayBuffer(dataLength)], { type: 'audio/wav' })
}

// ─── WAV parsing ─────────────────────────────────────────────────────────────

/**
 * Read a Blob (or a slice of it) as a Uint8Array.
 * Works in both browser and jsdom test environments where
 * Blob.arrayBuffer() or Blob.slice().arrayBuffer() may be missing.
 */
export async function readBlobAsUint8Array(blob: Blob, maxBytes?: number): Promise<Uint8Array> {
  const target = maxBytes != null && maxBytes < blob.size ? blob.slice(0, maxBytes) : blob

  if (typeof target.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await target.arrayBuffer())
    } catch {
      // fall through
    }
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
      } else {
        reject(new Error('FileReader did not return ArrayBuffer'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsArrayBuffer(target)
  })
}

/**
 * Walk the RIFF chunks of a WAV blob once and report what was found.
 * Never throws: `isRiffWav` tells you whether the bytes are a RIFF/WAVE file,
 * `fmt` is null when the fmt chunk is missing.
 */
export async function readWavHeader(blob: Blob): Promise<{
  isRiffWav: boolean
  fmt: WavFormat | null
  dataOffset: number
  dataLength: number
}> {
  const headerData = await readBlobAsUint8Array(blob, 1024)
  const view = new DataView(headerData.buffer)

  const isRiffWav =
    String.fromCharCode(...headerData.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...headerData.slice(8, 12)) === 'WAVE'

  let offset = 12
  let fmt: WavFormat | null = null
  let dataOffset = -1
  let dataLength = 0

  while (offset + 8 <= headerData.length) {
    const chunkId = String.fromCharCode(...headerData.slice(offset, offset + 4))
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        numChannels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        blockAlign: view.getUint16(offset + 20, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      }
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataLength = chunkSize
      break
    }

    offset += 8 + chunkSize
  }

  return { isRiffWav, fmt, dataOffset, dataLength }
}

/**
 * Parse WAV header from a blob, returning format info and data region.
 * Only reads the first 1024 bytes — does NOT load the full blob into memory.
 */
export async function parseWavHeaderFromBlob(blob: Blob): Promise<WavHeader> {
  const { isRiffWav, fmt, dataOffset, dataLength } = await readWavHeader(blob)

  if (!isRiffWav) throw new Error('Not a RIFF WAV file')
  if (!fmt || dataOffset === -1) throw new Error('Invalid WAV: missing fmt or data chunk')

  return { fmt, dataOffset, dataLength }
}

/**
 * Parse a WAV blob header and return the accurate duration in seconds.
 * Handles arbitrary chunk layouts (extra LIST/fact/etc. chunks before data).
 *
 * Never throws: a blob that is not a WAV falls back to a size estimate, so one
 * bad segment cannot take down a whole generation run.
 */
export async function parseWavDuration(blob: Blob): Promise<number> {
  const { isRiffWav, fmt, dataLength } = await readWavHeader(blob)

  if (!isRiffWav) {
    // Not a valid WAV — fall back to blob-size estimate (24kHz 16-bit mono)
    const fallback = (blob.size - WAV_HEADER_BYTES) / (24000 * 2)
    return fallback > 0 ? fallback : 0
  }

  const sampleRate = fmt?.sampleRate ?? 24000
  const numChannels = fmt?.numChannels ?? 1
  const bitsPerSample = fmt?.bitsPerSample ?? 16

  if (dataLength <= 0) {
    // Could not find data chunk — fall back using parsed fmt values
    const fallback =
      (blob.size - WAV_HEADER_BYTES) / (sampleRate * (bitsPerSample / 8) * numChannels)
    return fallback > 0 ? fallback : 0
  }

  const bytesPerSec = sampleRate * (bitsPerSample / 8) * numChannels
  return bytesPerSec > 0 ? dataLength / bytesPerSec : 0
}

// ─── WAV duration / metadata ─────────────────────────────────────────────────

/** Get audio duration from blob using the Audio element. */
export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      reject(new Error('Failed to load audio metadata'))
    })
    audio.src = URL.createObjectURL(blob)
  })
}

// ─── WAV concatenation ──────────────────────────────────────────────────────

/**
 * Resample a WAV blob's PCM data to match a target format.
 * Uses linear interpolation. Returns a new WAV blob in the target format.
 */
async function resampleWavBlob(
  blob: Blob,
  srcInfo: WavHeader,
  targetFmt: WavFormat
): Promise<Blob> {
  const srcData = new Int16Array(
    await blob.slice(srcInfo.dataOffset, srcInfo.dataOffset + srcInfo.dataLength).arrayBuffer()
  )
  const srcChannels = srcInfo.fmt.numChannels
  const targetChannels = targetFmt.numChannels
  const srcSampleRate = srcInfo.fmt.sampleRate
  const targetSampleRate = targetFmt.sampleRate

  const srcFrames = srcData.length / srcChannels
  const ratio = targetSampleRate / srcSampleRate
  const targetFrames = Math.round(srcFrames * ratio)
  const targetData = new Int16Array(targetFrames * targetChannels)

  for (let i = 0; i < targetFrames; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, srcFrames - 1)
    const frac = srcPos - i0

    for (let ch = 0; ch < targetChannels; ch++) {
      const srcCh = Math.min(ch, srcChannels - 1)
      const v0 = srcData[i0 * srcChannels + srcCh]
      const v1 = srcData[i1 * srcChannels + srcCh]
      targetData[i * targetChannels + ch] = Math.round(v0 + frac * (v1 - v0))
    }
  }

  const targetDataLength = targetData.byteLength
  const headerBuffer = buildWavHeader(targetFmt, targetDataLength)

  return new Blob([headerBuffer, targetData.buffer], { type: 'audio/wav' })
}

/**
 * Incrementally concatenate WAV segments, loading one at a time.
 * This keeps peak memory at ~1 segment blob instead of N segments.
 *
 * @param segmentCount - Total number of segments
 * @param getSegmentBlob - Async function that loads a single segment blob by index.
 *   The caller is responsible for releasing the blob after this function returns.
 */
export async function incrementalConcatWav(
  segmentCount: number,
  getSegmentBlob: (index: number) => Promise<Blob | null>,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  if (segmentCount === 0) throw new Error('No segments to concatenate')

  const parts: BlobPart[] = []
  let totalDataLength = 0
  let referenceFmt: WavFormat | null = null

  for (let i = 0; i < segmentCount; i++) {
    onProgress?.(i, segmentCount)

    const blob = await getSegmentBlob(i)
    if (!blob || blob.size === 0) {
      logger.warn(`[incrementalConcat] Segment ${i} is empty, inserting 1s silence`)
      const silence = createSilentWav(1)
      const silenceInfo = await parseWavHeaderFromBlob(silence)
      if (!referenceFmt) referenceFmt = silenceInfo.fmt
      parts.push(
        silence.slice(silenceInfo.dataOffset, silenceInfo.dataOffset + silenceInfo.dataLength)
      )
      totalDataLength += silenceInfo.dataLength
      continue
    }

    const info = await parseWavHeaderFromBlob(blob)

    if (!referenceFmt) {
      referenceFmt = info.fmt
    } else if (
      info.fmt.audioFormat !== referenceFmt.audioFormat ||
      info.fmt.numChannels !== referenceFmt.numChannels ||
      info.fmt.sampleRate !== referenceFmt.sampleRate ||
      info.fmt.bitsPerSample !== referenceFmt.bitsPerSample
    ) {
      // Resample mismatched segment to match reference format
      logger.warn(
        `[incrementalConcat] Segment ${i} format mismatch (SR: ${info.fmt.sampleRate} vs ${referenceFmt.sampleRate}), resampling`
      )
      const resampled = await resampleWavBlob(blob, info, referenceFmt)
      const resampledInfo = await parseWavHeaderFromBlob(resampled)
      parts.push(
        resampled.slice(
          resampledInfo.dataOffset,
          resampledInfo.dataOffset + resampledInfo.dataLength
        )
      )
      totalDataLength += resampledInfo.dataLength
      await new Promise((r) => setTimeout(r, 0))
      continue
    }

    // Blob.slice() is zero-copy — it creates a lightweight view, not a full copy.
    // The original blob can be GC'd after this loop iteration.
    parts.push(blob.slice(info.dataOffset, info.dataOffset + info.dataLength))
    totalDataLength += info.dataLength

    // Yield to event loop so GC can reclaim the segment blob
    await new Promise((r) => setTimeout(r, 0))
  }

  if (!referenceFmt) throw new Error('No valid segments found')

  parts.unshift(buildWavHeader(referenceFmt, totalDataLength))

  onProgress?.(segmentCount, segmentCount)

  return new Blob(parts, { type: 'audio/wav' })
}

/**
 * Concatenate WAV blobs into one WAV blob (zero-copy Blob composition).
 *
 * The header of each blob is parsed, so blobs whose header is longer than the
 * canonical 44 bytes are spliced correctly. Blobs must share a format.
 */
export async function concatWavBlobs(blobs: Blob[]): Promise<Blob> {
  if (!blobs || blobs.length === 0) throw new Error('No chapters to concatenate')

  const parts: BlobPart[] = []
  let totalDataLength = 0
  const referenceFmt = (await parseWavHeaderFromBlob(blobs[0])).fmt

  for (let i = 0; i < blobs.length; i++) {
    const info = await parseWavHeaderFromBlob(blobs[i])

    if (
      info.fmt.audioFormat !== referenceFmt.audioFormat ||
      info.fmt.numChannels !== referenceFmt.numChannels ||
      info.fmt.sampleRate !== referenceFmt.sampleRate ||
      info.fmt.bitsPerSample !== referenceFmt.bitsPerSample
    ) {
      throw new Error(
        `WAV format mismatch at blob ${i + 1} (SR: ${info.fmt.sampleRate} vs ${referenceFmt.sampleRate}, CH: ${info.fmt.numChannels} vs ${referenceFmt.numChannels})`
      )
    }

    parts.push(blobs[i].slice(info.dataOffset, info.dataOffset + info.dataLength))
    totalDataLength += info.dataLength
  }

  parts.unshift(buildWavHeader(referenceFmt, totalDataLength))

  return new Blob(parts, { type: 'audio/wav' })
}

/** Download a blob as a file. */
export function downloadAudioFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
