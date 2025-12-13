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

    // Validate and clean input text
    const cleanText = text.trim()
    if (!cleanText) {
      logger.warn('Empty text provided to Piper generate')
      throw new Error('Cannot generate audio from empty text')
    }

    logger.info(`Generating audio for text (${cleanText.length} chars)`)
    options.onProgress?.('Generating audio...')

    try {
      // Split text into sentences to avoid memory issues with large inputs
      // Simple regex split on punctuation followed by whitespace
      const sentences = cleanText.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [cleanText]
      const chunks = this.chunkSentences(sentences, 400) // group to reduce call count
      const blobs: Blob[] = []

      logger.info(
        `Preparing Piper segments: ${sentences.length} sentences grouped into ${chunks.length} chunk(s)`
      )

      for (let i = 0; i < chunks.length; i++) {
        const sentence = chunks[i]

        if (chunks.length > 1) {
          options.onProgress?.(`Generating segment ${i + 1}/${chunks.length}...`)
        }

        logger.debug(
          `Generating segment ${i + 1}: "${sentence.substring(0, 50)}${sentence.length > 50 ? '...' : ''}"`
        )

        try {
          const generated = await this.generateChunkWithRetry(sentence, voiceId, options, 0)
          blobs.push(...generated)
        } catch (segmentError) {
          logger.error(`Failed to generate segment ${i + 1}:`, segmentError)
          // Continue with other segments rather than failing entirely
          continue
        }
      }

      if (blobs.length === 0) {
        logger.error('No audio blobs generated from text', {
          textLength: cleanText.length,
          sentenceCount: sentences.length,
          chunkCount: chunks.length,
          firstChunk: chunks[0]?.substring(0, 100),
        })
        throw new Error(
          `No audio generated from ${chunks.length} text segment(s). Check text format and voice model compatibility.`
        )
      }

      logger.info(`Successfully generated ${blobs.length} audio blobs`)

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

  // Normalize possible outputs from tts.predict into a Blob
  private toWavBlob(data: any): Blob | null {
    if (!data) return null
    if (data instanceof Blob) return data

    if (ArrayBuffer.isView(data)) {
      // Copy into a regular ArrayBuffer to avoid SharedArrayBuffer issues
      const view = new Uint8Array(data.buffer.byteLength)
      view.set(new Uint8Array(data.buffer))
      return new Blob([view], { type: 'audio/wav' })
    }

    if (data instanceof ArrayBuffer) {
      return new Blob([new Uint8Array(data)], { type: 'audio/wav' })
    }

    return null
  }

  private async concatenateWavBlobs(blobs: Blob[]): Promise<Blob> {
    if (blobs.length === 0) {
      throw new Error('Cannot concatenate empty blob array')
    }

    if (blobs.length === 1) {
      return blobs[0]
    }

    const buffers = await Promise.all(blobs.map((b) => this.toArrayBufferSafe(b)))

    // Calculate total length (excluding headers of all but first)
    // WAV header is 44 bytes
    const headerLength = 44
    let totalDataLength = 0

    for (const buffer of buffers) {
      if (buffer.byteLength > headerLength) {
        totalDataLength += buffer.byteLength - headerLength
      }
    }

    if (totalDataLength === 0) {
      logger.warn('All WAV buffers are too small to concatenate')
      return blobs[0]
    }

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

  private async generateChunkWithRetry(
    text: string,
    voiceId: string,
    options: { onProgress?: (msg: string) => void },
    depth: number
  ): Promise<Blob[]> {
    const maxDepth = 2
    try {
      const wav = await tts.predict({
        text,
        voiceId: voiceId as any,
      })

      const blob = this.toWavBlob(wav)
      if (blob && blob.size > 0) {
        return [blob]
      }

      logger.warn('Piper predict returned empty/unsupported audio', {
        textLength: text.length,
        type: (wav as any)?.constructor?.name || typeof wav,
        size: (wav as Blob)?.size,
      })
      throw new Error('Empty audio')
    } catch (err) {
      if (depth >= maxDepth || text.length < 80) {
        throw err
      }

      // Retry by splitting the text into smaller parts
      const parts = this.splitTextForRetry(text)
      logger.warn('Retrying Piper segment with smaller parts', {
        depth,
        parts: parts.length,
        lengths: parts.map((p) => p.length),
      })

      const results: Blob[] = []
      for (const part of parts) {
        const res = await this.generateChunkWithRetry(part, voiceId, options, depth + 1)
        results.push(...res)
      }
      return results
    }
  }

  private splitTextForRetry(text: string): string[] {
    // Prefer sentence-based splitting
    const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text]
    if (sentences.length > 1) {
      const mid = Math.ceil(sentences.length / 2)
      return [
        sentences.slice(0, mid).join(' ').trim(),
        sentences.slice(mid).join(' ').trim(),
      ].filter(Boolean)
    }

    // Fallback to character split
    const midChar = Math.floor(text.length / 2)
    return [text.slice(0, midChar).trim(), text.slice(midChar).trim()].filter(Boolean)
  }

  // Group adjacent sentences into chunks capped by maxChars to reduce predict calls
  private chunkSentences(sentences: string[], maxChars: number): string[] {
    const chunks: string[] = []
    let current = ''

    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (!trimmed) continue

      if ((current + ' ' + trimmed).trim().length > maxChars && current) {
        chunks.push(current.trim())
        current = trimmed
      } else {
        current = (current + ' ' + trimmed).trim()
      }
    }

    if (current) {
      chunks.push(current.trim())
    }

    return chunks.length > 0 ? chunks : sentences.map((s) => s.trim()).filter(Boolean)
  }

  private async toArrayBufferSafe(blob: Blob): Promise<ArrayBuffer> {
    if (typeof (blob as any).arrayBuffer === 'function') {
      return (blob as any).arrayBuffer()
    }

    // Fallback for environments where Blob.arrayBuffer is missing
    return new Response(blob).arrayBuffer()
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
