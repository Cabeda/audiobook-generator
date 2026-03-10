/**
 * WAV file format utilities.
 *
 * Pure functions for creating, parsing, and manipulating WAV audio data.
 * No FFmpeg dependency — these work with raw ArrayBuffers and Blobs.
 *
 * Extracted from audioConcat to isolate WAV-specific concerns.
 */

import logger from './utils/logger'

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
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // Write WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, format, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Write audio data
  floatTo16BitPCM(view, 44, data)

  return new Blob([buffer], { type: 'audio/wav' })
}

/** Create a silent WAV blob of specified duration. */
export function createSilentWav(durationSeconds: number = 1, sampleRate: number = 44100): Blob {
  const numChannels = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const totalSamples = sampleRate * durationSeconds
  const dataLength = totalSamples * numChannels * bytesPerSample

  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)

  // Data is already 0 (silence) in new ArrayBuffer

  return new Blob([buffer], { type: 'audio/wav' })
}

// ─── WAV parsing ─────────────────────────────────────────────────────────────

/**
 * Parse WAV header from a blob, returning format info and data region.
 * Only reads the first 1024 bytes — does NOT load the full blob into memory.
 */
export async function parseWavHeaderFromBlob(blob: Blob) {
  const headerData = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
  const view = new DataView(headerData.buffer)

  if (String.fromCharCode(...headerData.slice(0, 4)) !== 'RIFF')
    throw new Error('Not a RIFF WAV file')
  if (String.fromCharCode(...headerData.slice(8, 12)) !== 'WAVE') throw new Error('Not a WAVE file')

  let offset = 12
  let fmt: {
    audioFormat: number
    numChannels: number
    sampleRate: number
    byteRate: number
    blockAlign: number
    bitsPerSample: number
  } | null = null
  let dataOffset = -1
  let dataLength = 0

  while (offset < headerData.length) {
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

  if (!fmt || dataOffset === -1) throw new Error('Invalid WAV: missing fmt or data chunk')

  return { fmt, dataOffset, dataLength }
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
 * Incrementally concatenate WAV segments, loading one at a time.
 * This keeps peak memory at ~1 segment blob instead of N segments.
 *
 * @param segmentCount - Total number of segments
 * @param getSegmentBlob - Async function that loads a single segment blob by index.
 *   The caller is responsible for releasing the blob after this function returns.
 * @param onProgress - Optional progress callback
 * @returns Combined WAV blob
 */
export async function incrementalConcatWav(
  segmentCount: number,
  getSegmentBlob: (index: number) => Promise<Blob | null>,
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  if (segmentCount === 0) throw new Error('No segments to concatenate')

  const parts: BlobPart[] = []
  let totalDataLength = 0
  let referenceFmt: Awaited<ReturnType<typeof parseWavHeaderFromBlob>>['fmt'] | null = null

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
    } else {
      // Validate format compatibility
      if (
        info.fmt.audioFormat !== referenceFmt.audioFormat ||
        info.fmt.numChannels !== referenceFmt.numChannels ||
        info.fmt.sampleRate !== referenceFmt.sampleRate ||
        info.fmt.bitsPerSample !== referenceFmt.bitsPerSample
      ) {
        throw new Error(
          `Segment ${i} format mismatch (SR: ${info.fmt.sampleRate} vs ${referenceFmt.sampleRate}, CH: ${info.fmt.numChannels} vs ${referenceFmt.numChannels})`
        )
      }
    }

    // Blob.slice() is zero-copy — it creates a lightweight view, not a full copy.
    // The original blob can be GC'd after this loop iteration.
    parts.push(blob.slice(info.dataOffset, info.dataOffset + info.dataLength))
    totalDataLength += info.dataLength

    // Yield to event loop so GC can reclaim the segment blob
    await new Promise((r) => setTimeout(r, 0))
  }

  if (!referenceFmt) throw new Error('No valid segments found')

  // Build WAV header
  const headerBuffer = new ArrayBuffer(44)
  const headerView = new DataView(headerBuffer)

  writeString(headerView, 0, 'RIFF')
  headerView.setUint32(4, 36 + totalDataLength, true)
  writeString(headerView, 8, 'WAVE')
  writeString(headerView, 12, 'fmt ')
  headerView.setUint32(16, 16, true)
  headerView.setUint16(20, referenceFmt.audioFormat, true)
  headerView.setUint16(22, referenceFmt.numChannels, true)
  headerView.setUint32(24, referenceFmt.sampleRate, true)
  headerView.setUint32(28, referenceFmt.byteRate, true)
  headerView.setUint16(32, referenceFmt.blockAlign, true)
  headerView.setUint16(34, referenceFmt.bitsPerSample, true)
  writeString(headerView, 36, 'data')
  headerView.setUint32(40, totalDataLength, true)

  parts.unshift(headerBuffer)

  onProgress?.(segmentCount, segmentCount)

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
