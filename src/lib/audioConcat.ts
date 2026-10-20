/**
 * Audio concatenation utilities for combining chapter audio into a complete audiobook.
 *
 * Pure WAV helpers (createSilentWav, parseWavHeaderFromBlob, audioBufferToWav, etc.)
 * live in ./wavUtils.ts.  This module re-exports them for backward compatibility.
 *
 * Encoding (MP3/M4B) is handled by Mediabunny via ./mediabunnyEncoder.ts.
 */
import logger from './utils/logger'
import { EncodingError } from './errors'
import { audioBufferToWav, concatWavBlobs } from './wavUtils'
import { exportMimeType, type AudioExportFormat } from './exportFormats'
import { convertWavToMp3 as mediabunnyConvertWavToMp3, convertWavToM4b } from './mediabunnyEncoder'

// Re-export WAV utilities so existing consumers don't break
export {
  writeString,
  floatTo16BitPCM,
  interleave,
  audioBufferToWav,
  createSilentWav,
  parseWavHeaderFromBlob,
  getAudioDuration,
  incrementalConcatWav,
  downloadAudioFile,
} from './wavUtils'

export type AudioChapter = {
  id: string
  title: string
  blob: Blob
  duration?: number
}

export type ConcatenationProgress = {
  current: number
  total: number
  status: 'loading' | 'decoding' | 'concatenating' | 'encoding' | 'complete'
  message: string
}

export type ConcatenationOptions = {
  format?: AudioExportFormat
  bitrate?: number // For MP3: 128, 192, 256, 320 kbps
  bookTitle?: string
  bookAuthor?: string
}

// Helper: resample and ensure channel counts are consistent
export function resampleAndNormalizeAudioBuffers(
  audioContext: BaseAudioContext,
  buffers: AudioBuffer[]
): AudioBuffer[] {
  const targetSampleRate = audioContext.sampleRate
  const targetNumChannels = Math.max(...buffers.map((b) => b.numberOfChannels))

  return buffers.map((buf) => {
    let converted = buf
    if (buf.numberOfChannels !== targetNumChannels) {
      converted = convertChannels(buf, targetNumChannels, audioContext)
    }
    if (converted.sampleRate !== targetSampleRate) {
      converted = resampleBuffer(converted, targetSampleRate, audioContext)
    }
    return converted
  })
}

/**
 * Convert various audio-like objects into a WAV Blob.
 */
export async function audioLikeToBlob(
  audio: unknown,
  _seen: WeakSet<object> = new WeakSet(),
  _depth = 0
): Promise<Blob> {
  if (!audio) throw new Error('No audio provided')
  try {
    if (typeof audio === 'object' && audio !== null) {
      if (_seen.has(audio)) {
        throw new Error('Detected circular audio wrapper reference during conversion')
      }
      _seen.add(audio)
    }
  } catch {
    // Some host wrappers might throw when used as map keys; ignore
  }

  if (audio instanceof Blob) return audio
  if (audio instanceof ArrayBuffer) return new Blob([audio], { type: 'audio/wav' })
  if (audio instanceof Uint8Array)
    return new Blob([new Uint8Array(audio).buffer], { type: 'audio/wav' })

  function hasArrayBufferMethod(
    a: unknown
  ): a is { arrayBuffer: () => Promise<ArrayBuffer>; type?: string } {
    return !!a && typeof (a as any).arrayBuffer === 'function'
  }

  function isAudioBufferLike(a: unknown): a is AudioBuffer {
    return (
      !!a &&
      typeof (a as any).numberOfChannels === 'number' &&
      typeof (a as any).getChannelData === 'function' &&
      typeof (a as any).sampleRate === 'number'
    )
  }

  if (hasArrayBufferMethod(audio)) {
    try {
      const arr = await audio.arrayBuffer()
      const t = (audio as any).type as string | undefined
      return new Blob([arr], { type: t || 'audio/wav' })
    } catch {
      // fall through
    }
  }

  if (isAudioBufferLike(audio)) {
    try {
      return audioBufferToWav(audio as AudioBuffer)
    } catch {
      // fall through
    }
  }

  if (_depth > 12) {
    throw new Error('Exceeded maximum audio wrapper unwrapping depth')
  }

  if (typeof (audio as any)?.then === 'function') {
    try {
      const resolved = await (audio as Promise<unknown>)
      return await audioLikeToBlob(resolved, _seen, _depth + 1)
    } catch {
      // fall through
    }
  }

  const ctorName = (audio as any)?.constructor?.name
  if (typeof ctorName === 'string' && ctorName.includes('JSHandle')) {
    const candidates = [
      (audio as any).value,
      (audio as any).json,
      (audio as any).toJSON,
      (audio as any).payload,
      typeof (audio as any).jsonValue === 'function' ? (audio as any).jsonValue() : undefined,
      typeof (audio as any).get === 'function' ? (audio as any).get() : undefined,
      typeof (audio as any).valueOf === 'function' ? (audio as any).valueOf() : undefined,
    ]

    for (const cand of candidates) {
      if (cand == null) continue
      try {
        const resolved = typeof (cand as any)?.then === 'function' ? await cand : cand
        const maybe = await audioLikeToBlob(resolved, _seen, _depth + 1)
        return maybe
      } catch {
        // try next candidate
      }
    }
    const repr = String(audio?.toString?.() ?? audio)
    if (repr.includes('JSHandle@error')) {
      logger.warn('[audioLikeToBlob] JSHandle reported an error state:', repr)
      throw new Error('JSHandle reported an error when attempting to convert to Blob')
    }
    logger.warn(
      '[audioLikeToBlob] Detected JSHandle-like wrapper but could not unwrap it. Throwing strict error.'
    )
    throw new Error('Unsupported JSHandle-like wrapper; could not convert to Blob')
  }

  throw new Error(
    `Unsupported audio type for conversion: ${String(audio?.constructor?.name || typeof audio)}`
  )
}

// Convert number of channels
function convertChannels(
  buffer: AudioBuffer,
  targetChannels: number,
  audioContext: BaseAudioContext
): AudioBuffer {
  if (buffer.numberOfChannels === targetChannels) return buffer
  const out = audioContext.createBuffer(targetChannels, buffer.length, buffer.sampleRate)

  for (let ch = 0; ch < targetChannels; ch++) {
    const outData = out.getChannelData(ch)
    if (ch < buffer.numberOfChannels) {
      outData.set(buffer.getChannelData(ch))
    } else {
      outData.set(buffer.getChannelData(buffer.numberOfChannels - 1))
    }
  }
  return out
}

// Resample AudioBuffer using linear interpolation
function resampleBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number,
  audioContext: BaseAudioContext
): AudioBuffer {
  if (buffer.sampleRate === targetSampleRate) return buffer

  const ratio = targetSampleRate / buffer.sampleRate
  const newLength = Math.round(buffer.length * ratio)
  const out = audioContext.createBuffer(buffer.numberOfChannels, newLength, targetSampleRate)

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const input = buffer.getChannelData(ch)
    const output = out.getChannelData(ch)
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i / ratio
      const i0 = Math.floor(srcIndex)
      const i1 = Math.min(i0 + 1, input.length - 1)
      const frac = srcIndex - i0
      output[i] = input[i0] + frac * (input[i1] - input[i0])
    }
  }
  return out
}

/**
 * Concatenate multiple audio blobs into a single audio file.
 */
export async function concatenateAudioChapters(
  chapters: AudioChapter[],
  options: ConcatenationOptions = {},
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
  const { format = 'wav', bitrate = 192 } = options
  if (chapters.length === 0) {
    throw new Error('No chapters to concatenate')
  }

  // Single WAV chapter shortcut
  if (chapters.length === 1 && format === 'wav' && chapters[0].blob.type === 'audio/wav') {
    return chapters[0].blob
  }

  // Optimized WAV concatenation path (zero-copy Blob composition)
  if (format === 'wav' && chapters.every((c) => c.blob.type.includes('wav'))) {
    try {
      logger.info('[audioConcat]', 'Using optimized WAV concatenation')
      return await concatWavBlobs(chapters.map((c) => c.blob))
    } catch (err) {
      logger.warn('[audioConcat]', 'Optimized WAV concat failed, falling back:', err)
    }
  }

  // For MP3/M4B/MP4: concatenate WAV blobs first, then encode with Mediabunny
  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'concatenating',
    message: 'Concatenating chapters...',
  })

  // First, produce a single WAV blob from all chapters
  let wavBlob: Blob
  try {
    wavBlob = await concatWavBlobs(chapters.map((c) => c.blob))
  } catch {
    // If optimized concat fails (format mismatch), fall back to WebAudio decode path
    wavBlob = await webAudioConcatToWav(chapters, onProgress)
  }

  onProgress?.({
    current: 0,
    total: 1,
    status: 'encoding',
    message: `Encoding to ${format.toUpperCase()}...`,
  })

  let outputBlob: Blob
  try {
    switch (format) {
      case 'mp3':
        outputBlob = await mediabunnyConvertWavToMp3(wavBlob, bitrate)
        break
      case 'm4b':
      case 'mp4': {
        outputBlob = await convertWavToM4b(wavBlob, bitrate)
        if (format === 'mp4') {
          outputBlob = new Blob([outputBlob], { type: exportMimeType('mp4') })
        }
        // Inject Nero chapter markers if we have multiple chapters with durations
        if (chapters.length > 1) {
          const { injectChapterMarkers } = await import('./m4bChapters')
          let startMs = 0
          const markers = chapters.map((ch) => {
            const marker = { title: ch.title, startTimeMs: startMs }
            startMs += (ch.duration || 0) * 1000
            return marker
          })
          outputBlob = await injectChapterMarkers(outputBlob, markers)
        }
        break
      }
      case 'wav':
      default:
        outputBlob = wavBlob
        break
    }
  } catch (err) {
    throw new EncodingError(
      `Failed to encode to ${format}: ${err instanceof Error ? err.message : String(err)}`,
      format,
      false,
      err instanceof Error ? err : undefined
    )
  }

  onProgress?.({
    current: 1,
    total: 1,
    status: 'complete',
    message: 'Audiobook created successfully!',
  })

  return outputBlob
}

/**
 * Convert WAV blob to MP3 blob using Mediabunny.
 */
export async function convertWavToMp3(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  return mediabunnyConvertWavToMp3(wavBlob, bitrate)
}

/**
 * Convert AudioBuffer to encoded blob (MP3/M4B/MP4).
 * Kept for backward compatibility — converts to WAV first, then encodes.
 */
export async function audioBufferToMp3(
  audioBuffer: AudioBuffer,
  bitrate: number,
  _chapters: AudioChapter[],
  options: ConcatenationOptions
): Promise<Blob> {
  const wavBlob = audioBufferToWav(audioBuffer)
  const format = options.format || 'mp3'

  switch (format) {
    case 'm4b':
    case 'mp4':
      return convertWavToM4b(wavBlob, bitrate)
    case 'mp3':
    default:
      return mediabunnyConvertWavToMp3(wavBlob, bitrate)
  }
}

/**
 * WebAudio-based fallback: decode all chapters, normalize, and produce a WAV blob.
 */
async function webAudioConcatToWav(
  chapters: AudioChapter[],
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
  let audioContext: AudioContext | OfflineAudioContext | null = null
  if (typeof (globalThis as any).AudioContext === 'function') {
    audioContext = new (globalThis as any).AudioContext()
  } else if (typeof (globalThis as any).OfflineAudioContext === 'function') {
    audioContext = new (globalThis as any).OfflineAudioContext(2, 1, 44100)
  } else if (typeof (globalThis as any).webkitAudioContext === 'function') {
    audioContext = new (globalThis as any).webkitAudioContext()
  }

  if (!audioContext) {
    throw new Error('Web Audio API not available and cannot concatenate audio')
  }

  const sampleRate = (audioContext as any)?.sampleRate || 44100

  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'loading',
    message: 'Loading audio chapters...',
  })

  const audioBuffers: AudioBuffer[] = []
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.({
      current: i + 1,
      total: chapters.length,
      status: 'decoding',
      message: `Decoding chapter ${i + 1}/${chapters.length}: ${chapters[i].title}`,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    try {
      const blob = chapters[i].blob
      if (blob.size === 0) {
        const silence = audioContext.createBuffer(1, sampleRate, sampleRate)
        audioBuffers.push(silence)
        continue
      }
      const arrayBuffer = await blob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      audioBuffers.push(audioBuffer)
    } catch (err) {
      logger.error(`[audioConcat] Failed to decode chapter ${i + 1} "${chapters[i].title}":`, err)
      try {
        const silence = audioContext.createBuffer(1, sampleRate, sampleRate)
        audioBuffers.push(silence)
      } catch {
        throw new Error(
          `Failed to decode audio for chapter ${i + 1} "${chapters[i].title}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  const normalizedBuffers = resampleAndNormalizeAudioBuffers(audioContext, audioBuffers)

  onProgress?.({
    current: 0,
    total: 1,
    status: 'concatenating',
    message: 'Concatenating audio chapters...',
  })

  const totalLength = normalizedBuffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const numberOfChannels = normalizedBuffers[0].numberOfChannels
  const outputBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate)

  let offset = 0
  for (const buffer of normalizedBuffers) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      outputBuffer.getChannelData(channel).set(buffer.getChannelData(channel), offset)
    }
    offset += buffer.length
  }

  if (typeof (audioContext as any).close === 'function') {
    try {
      await (audioContext as any).close()
    } catch {
      // Swallow
    }
  }

  return audioBufferToWav(outputBuffer)
}

/**
 * Create chapter markers metadata (for future M4B support)
 */
export function createChapterMarkers(
  chapters: AudioChapter[],
  audioBuffers: AudioBuffer[]
): string {
  let currentTime = 0
  const markers: string[] = []

  for (let i = 0; i < chapters.length; i++) {
    const duration = audioBuffers[i].duration
    const startTime = formatTimestamp(currentTime)

    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}=${startTime}`)
    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}NAME=${chapters[i].title}`)

    currentTime += duration
  }

  return markers.join('\n')
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}
