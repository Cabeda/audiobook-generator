import * as tts from '@diffusionstudio/vits-web'
import * as ort from 'onnxruntime-web'
import logger from '../utils/logger'

// Configure ONNX Runtime for the worker environment
// If crossOriginIsolated is false, we must disable multi-threading to avoid crashes
if (typeof self !== 'undefined' && !self.crossOriginIsolated) {
  logger.info('Running in non-isolated context, forcing single-threaded execution')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
} else {
  logger.info('Running in crossOriginIsolated context, allowing multi-threading')
}

export interface PiperVoice {
  key: string
  name: string
  language: string
  quality: string
}

export class PiperClient {
  private static instance: PiperClient
  private initialized = false

  private constructor() {}

  static getInstance(): PiperClient {
    if (!PiperClient.instance) {
      PiperClient.instance = new PiperClient()
    }
    return PiperClient.instance
  }

  async getVoices(): Promise<PiperVoice[]> {
    const voicesMap = await tts.voices()
    return Object.entries(voicesMap).map(([key, data]: [string, any]) => {
      // If voicesMap is an array, key is an index. Use data.key if available.
      const voiceId = Array.isArray(voicesMap) && data.key ? data.key : key
      return {
        key: voiceId,
        name: data.name,
        language: data.language.name_native,
        quality: data.quality,
      }
    })
  }

  async generate(
    text: string,
    options: {
      voiceId?: string
      onProgress?: (msg: string) => void
    } = {}
  ): Promise<Blob> {
    const voiceId = options.voiceId || 'en_US-hfc_female-medium'
    logger.info('Piper generate called with voiceId:', voiceId)

    // Check if model is stored
    const storedModels = await tts.stored()
    logger.info('Piper stored models:', storedModels)
    const isStored = storedModels.includes(voiceId as any)

    if (!isStored) {
      logger.info(`Model ${voiceId} not stored, downloading...`)
      options.onProgress?.(`Downloading voice model: ${voiceId}...`)
      await tts.download(voiceId as any, (progress: any) => {
        const percent = Math.round((progress.loaded * 100) / progress.total)
        options.onProgress?.(`Downloading model: ${percent}%`)
      })
    }

    options.onProgress?.('Generating audio...')

    try {
      // Split text into sentences to avoid memory issues with large inputs
      // Simple regex split on punctuation followed by whitespace
      const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text]
      const blobs: Blob[] = []

      logger.info(`Splitting text into ${sentences.length} segments for generation`)

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i].trim()
        if (!sentence) continue

        if (sentences.length > 1) {
          options.onProgress?.(`Generating segment ${i + 1}/${sentences.length}...`)
        }

        // Skip empty or very short segments that might cause issues
        if (sentence.length < 2) continue

        const wav = await tts.predict({
          text: sentence,
          voiceId: voiceId as any,
        })
        blobs.push(wav)
      }

      if (blobs.length === 0) {
        throw new Error('No audio generated')
      }

      if (blobs.length === 1) {
        return blobs[0]
      }

      // Concatenate blobs
      // Note: These are WAV blobs with headers. We need to strip headers from subsequent blobs
      // and update the header of the first blob (or create a new one).
      // For simplicity, we can use a helper or just naively concatenate if we accept some header noise,
      // BUT valid WAV concatenation requires stripping headers.

      return await this.concatenateWavBlobs(blobs)
    } catch (err) {
      logger.error('Piper generation failed:', err)
      throw err
    }
  }

  private async concatenateWavBlobs(blobs: Blob[]): Promise<Blob> {
    const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()))

    // Calculate total length (excluding headers of all but first)
    // WAV header is 44 bytes
    const headerLength = 44
    let totalDataLength = 0

    for (const buffer of buffers) {
      if (buffer.byteLength > headerLength) {
        totalDataLength += buffer.byteLength - headerLength
      }
    }

    if (totalDataLength === 0) return blobs[0] // Should not happen if check above passes

    const resultBuffer = new Uint8Array(headerLength + totalDataLength)

    // Copy header from first valid buffer
    const firstBuffer = buffers.find((b) => b.byteLength > headerLength) || buffers[0]
    resultBuffer.set(new Uint8Array(firstBuffer.slice(0, headerLength)), 0)

    // Update total size in header (bytes 4-7) = 36 + SubChunk2Size
    const totalSize = 36 + totalDataLength
    const view = new DataView(resultBuffer.buffer)
    view.setUint32(4, totalSize, true)

    // Update data size in header (bytes 40-43) = SubChunk2Size
    view.setUint32(40, totalDataLength, true)

    // Copy data
    let offset = headerLength
    for (const buffer of buffers) {
      if (buffer.byteLength > headerLength) {
        const data = new Uint8Array(buffer.slice(headerLength))
        resultBuffer.set(data, offset)
        offset += data.length
      }
    }

    return new Blob([resultBuffer], { type: 'audio/wav' })
  }
}

export const piperClient = PiperClient.getInstance()

export async function generateVoice(
  params: {
    text: string
    voice?: string
    speed?: number // Piper doesn't support speed directly in predict yet, but we keep interface
  },
  onChunkProgress?: (current: number, total: number) => void, // Not supported by Piper
  onProgress?: (status: string) => void
): Promise<Blob> {
  return piperClient.generate(params.text, {
    voiceId: params.voice,
    onProgress,
  })
}
