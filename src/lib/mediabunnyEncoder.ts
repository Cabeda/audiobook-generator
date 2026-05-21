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

  logger.info('[mediabunny]', `Converting WAV (${wavBlob.size} bytes) to MP3 at ${bitrate}kbps`)

  let input: InstanceType<typeof Input>
  try {
    input = new Input({
      source: new BlobSource(wavBlob),
      formats: WAV_FORMATS,
    })
  } catch (err) {
    logger.error('[mediabunny]', 'Failed to create Input:', err)
    throw new Error(`Failed to create Mediabunny Input: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const output = new Output({
    format: new Mp3OutputFormat(),
    target: new BufferTarget(),
  })

  let conversion: Awaited<ReturnType<typeof Conversion.init>>
  try {
    conversion = await Conversion.init({
      input,
      output,
      audio: { bitrate: bitrate * 1000 },
    })
  } catch (err) {
    logger.error('[mediabunny]', 'Conversion.init failed:', err)
    throw new Error(`MP3 Conversion.init failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ')
    logger.error('[mediabunny]', 'Conversion not valid:', reasons)
    throw new Error(`MP3 conversion not possible: ${reasons}`)
  }

  try {
    await conversion.execute()
  } catch (err) {
    logger.error('[mediabunny]', 'conversion.execute() failed:', err)
    throw new Error(`MP3 encoding failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error('MP3 conversion produced no output')
  logger.info('[mediabunny]', `MP3 conversion complete: ${buffer.byteLength} bytes`)
  return new Blob([buffer], { type: 'audio/mpeg' })
}

/**
 * Convert a WAV Blob to M4B/MP4 (AAC) using Mediabunny's Conversion API.
 */
export async function convertWavToM4b(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  await ensureCodecs()

  logger.info('[mediabunny]', `Converting WAV (${wavBlob.size} bytes) to M4B at ${bitrate}kbps`)

  let input: InstanceType<typeof Input>
  try {
    input = new Input({
      source: new BlobSource(wavBlob),
      formats: WAV_FORMATS,
    })
  } catch (err) {
    logger.error('[mediabunny]', 'Failed to create Input:', err)
    throw new Error(`Failed to create Mediabunny Input: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  })

  let conversion: Awaited<ReturnType<typeof Conversion.init>>
  try {
    conversion = await Conversion.init({
      input,
      output,
      audio: { bitrate: bitrate * 1000 },
    })
  } catch (err) {
    logger.error('[mediabunny]', 'Conversion.init failed:', err)
    throw new Error(`M4B Conversion.init failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ')
    logger.error('[mediabunny]', 'Conversion not valid:', reasons)
    throw new Error(`M4B conversion not possible: ${reasons}`)
  }

  try {
    await conversion.execute()
  } catch (err) {
    logger.error('[mediabunny]', 'conversion.execute() failed:', err)
    throw new Error(`M4B encoding failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error('M4B conversion produced no output')
  logger.info('[mediabunny]', `M4B conversion complete: ${buffer.byteLength} bytes`)
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
