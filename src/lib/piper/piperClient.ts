import * as tts from '@diffusionstudio/vits-web'
import * as ort from 'onnxruntime-web'
import logger from '../utils/logger'
import { MIN_TEXT_LENGTH } from '../audioConstants'
import { createSilentWav } from '../audioConcat'

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
      const failedSegments: Array<{ index: number; text: string; error: string }> = []

      logger.info(
        `Preparing Piper segments: ${sentences.length} sentences grouped into ${chunks.length} chunk(s)`
      )

      // If all chunks were filtered out (all too short), return silent audio
      if (chunks.length === 0) {
        logger.warn(
          `All text segments were too short (< ${MIN_TEXT_LENGTH} chars), skipping audio generation`
        )
        // Return a minimal silent WAV file (0 duration) instead of throwing an error
        return createSilentWav(0)
      }

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
          logger.debug(`Segment ${i + 1} succeeded: ${generated.length} blob(s)`)
          blobs.push(...generated)
        } catch (segmentError) {
          const errorMsg =
            segmentError instanceof Error ? segmentError.message : String(segmentError)
          logger.error(`Failed to generate segment ${i + 1}:`, {
            message: errorMsg,
            stack: segmentError instanceof Error ? segmentError.stack : undefined,
            cause: segmentError instanceof Error ? segmentError.cause : null,
            name: segmentError instanceof Error ? segmentError.name : undefined,
            textLength: sentence.length,
            text: sentence.substring(0, 100),
          })
          failedSegments.push({
            index: i + 1,
            text: sentence.substring(0, 100),
            error: errorMsg,
          })
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
          failedSegments: failedSegments.length,
        })

        // Fallback: try single large predict call if chunking failed
        logger.warn('Attempting fallback: single large Piper call')
        let fallbackErrorMsg = ''
        try {
          const result = await this.generateChunkWithRetry(cleanText, voiceId, options, 0)
          if (result.length > 0) {
            logger.info('Fallback succeeded with single call')
            return result.length === 1 ? result[0] : await this.concatenateWavBlobs(result)
          }
        } catch (fallbackErr) {
          fallbackErrorMsg =
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          logger.error('Fallback single call also failed:', {
            message: fallbackErrorMsg,
            cause: fallbackErr instanceof Error ? fallbackErr.cause : null,
          })
        }

        // Build detailed error message with context
        const errorDetails = [
          `TTS generation failed: No audio generated from ${chunks.length} text segment(s).`,
          '',
          `Voice model: ${voiceId}`,
          `Text length: ${cleanText.length} characters`,
          `Total sentences: ${sentences.length}`,
          `Failed segments: ${failedSegments.length}`,
        ]

        if (fallbackErrorMsg) {
          errorDetails.push(``, `Fallback attempt also failed:`, `${fallbackErrorMsg}`)
        }

        // Include details of failed segments
        if (failedSegments.length > 0) {
          errorDetails.push('', 'Failed segment details:')
          failedSegments.slice(0, 3).forEach((seg) => {
            errorDetails.push(
              `  Segment ${seg.index}: "${seg.text}${seg.text.length >= 100 ? '...' : ''}"`
            )
            errorDetails.push(`  Error: ${seg.error}`)
          })
          if (failedSegments.length > 3) {
            errorDetails.push(`  ... and ${failedSegments.length - 3} more segment(s)`)
          }
        } else if (chunks.length > 0) {
          // If no segments were tried or all failed before generation
          errorDetails.push(
            '',
            `First text segment attempted:`,
            `"${chunks[0]?.substring(0, 150)}${chunks[0]?.length > 150 ? '...' : ''}"`
          )
        }

        errorDetails.push('', 'Troubleshooting: Check text format and voice model compatibility.')

        throw new Error(errorDetails.join('\n'))
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
  private toWavBlob(data: unknown): Blob | null {
    if (!data) return null
    if (data instanceof Blob) return data

    if (ArrayBuffer.isView(data)) {
      // TypedArray: copy the actual view bytes, not the entire buffer
      const typedArray = data as ArrayBufferView
      const byteLength = typedArray.byteLength
      const byteOffset = 'byteOffset' in typedArray ? typedArray.byteOffset : 0
      const view = new Uint8Array(byteLength)
      view.set(new Uint8Array(typedArray.buffer, byteOffset, byteLength))
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

    // Guard: very short text is unlikely to succeed, return silent audio for consistency
    if (text.length < MIN_TEXT_LENGTH) {
      logger.debug(`Text too short (${text.length} chars), returning silent audio`)
      return [createSilentWav(0)]
    }

    try {
      logger.debug(`Calling tts.predict at depth ${depth}`, {
        textLength: text.length,
        textPreview: text.substring(0, 100),
        voiceId,
      })

      const wav = await tts.predict({
        text,
        voiceId: voiceId as any,
      })

      logger.debug(`tts.predict returned`, {
        wavType: wav?.constructor?.name || typeof wav,
        wavSize: (wav as Blob)?.size,
        isBlob: wav instanceof Blob,
        isArrayBuffer: wav instanceof ArrayBuffer,
        isArrayBufferView: ArrayBuffer.isView(wav),
      })

      const blob = this.toWavBlob(wav)
      if (blob && blob.size > 0) {
        logger.debug(`Successfully generated ${blob.size} bytes`, { textLength: text.length })
        return [blob]
      }

      logger.error('Piper predict returned empty/unsupported audio', {
        textLength: text.length,
        type: (wav as any)?.constructor?.name || typeof wav,
        size: blob?.size ?? 0,
        blobExists: !!blob,
        wavType: typeof wav,
        wavValue: wav === null ? 'null' : wav === undefined ? 'undefined' : 'exists',
        text: text.substring(0, 200),
      })
      throw new Error('Empty audio from predict')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : undefined

      logger.error(`Predict attempt at depth ${depth} failed: ${errMsg}`, {
        textLength: text.length,
        errorMessage: errMsg,
        errorStack: errStack,
        errorType: err?.constructor?.name || typeof err,
        text: text.substring(0, 200),
      })

      if (depth >= maxDepth || text.length < 80) {
        throw err
      }

      // Retry by splitting the text into smaller parts
      const parts = this.splitTextForRetry(text)
      if (parts.length <= 1) {
        throw err
      }

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

      // Skip very short segments (< MIN_TEXT_LENGTH chars) that are likely formatting artifacts
      // like "1.", "2.", etc. that don't need to be spoken
      if (trimmed.length < MIN_TEXT_LENGTH) {
        logger.debug(`Skipping very short segment: "${trimmed}"`)
        continue
      }

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
