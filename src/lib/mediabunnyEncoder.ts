/**
 * Mediabunny-based audio encoding module.
 * Replaces FFmpeg WASM with browser-native WebCodecs via Mediabunny.
 */
import {
  Input,
  Output,
  Conversion,
  BlobSource,
  BufferTarget,
  Mp3OutputFormat,
  Mp4OutputFormat,
  canEncodeAudio,
  WAVE,
} from 'mediabunny'
import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import { registerAacEncoder } from '@mediabunny/aac-encoder'
import logger from './utils/logger'

// Use the proper WAVE InputFormat constant
const WAV_FORMATS = [WAVE]

let codecsRegistered = false

/**
 * Lazily register codec polyfills only when native support is missing.
 */
async function ensureCodecs(): Promise<void> {
  if (codecsRegistered) return

  if (!(await canEncodeAudio('mp3'))) {
    logger.info('[mediabunny]', 'Registering MP3 encoder polyfill')
    registerMp3Encoder()
  }

  if (!(await canEncodeAudio('aac'))) {
    logger.info('[mediabunny]', 'Registering AAC encoder polyfill')
    registerAacEncoder()
  }

  codecsRegistered = true
}

/**
 * Convert a WAV Blob to MP3 using Mediabunny's Conversion API.
 */
export async function convertWavToMp3(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  await ensureCodecs()

  const input = new Input({
    source: new BlobSource(wavBlob),
    formats: WAV_FORMATS,
  })

  const output = new Output({
    format: new Mp3OutputFormat(),
    target: new BufferTarget(),
  })

  const conversion = await Conversion.init({
    input,
    output,
    audio: { bitrate: bitrate * 1000 },
  })

  if (!conversion.isValid) {
    throw new Error(
      `MP3 conversion not possible: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`
    )
  }

  await conversion.execute()
  const buffer = output.target.buffer
  if (!buffer) throw new Error('MP3 conversion produced no output')
  return new Blob([buffer], { type: 'audio/mpeg' })
}

/**
 * Convert a WAV Blob to M4B/MP4 (AAC) using Mediabunny's Conversion API.
 */
export async function convertWavToM4b(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  await ensureCodecs()

  const input = new Input({
    source: new BlobSource(wavBlob),
    formats: WAV_FORMATS,
  })

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })

  const conversion = await Conversion.init({
    input,
    output,
    audio: { bitrate: bitrate * 1000 },
  })

  if (!conversion.isValid) {
    throw new Error(
      `M4B conversion not possible: ${conversion.discardedTracks.map((t) => t.reason).join(', ')}`
    )
  }

  await conversion.execute()
  const buffer = output.target.buffer
  if (!buffer) throw new Error('M4B conversion produced no output')
  return new Blob([buffer], { type: 'audio/m4b' })
}

/**
 * Check if the browser supports the required encoding capabilities.
 */
export async function checkEncodingSupport(): Promise<{
  mp3: boolean
  aac: boolean
  native: boolean
}> {
  const mp3Native = await canEncodeAudio('mp3')
  const aacNative = await canEncodeAudio('aac')

  return {
    mp3: true, // Always available via polyfill
    aac: true, // Always available via polyfill
    native: mp3Native || aacNative,
  }
}
