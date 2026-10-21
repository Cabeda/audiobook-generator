import logger from './lib/utils/logger'
import { getTTSEngine, type TTSEngineConfig, type TTSModelType } from './lib/tts/ttsModels'

console.log('[Worker] Worker script loaded')

// Global error handler
self.onerror = function (msg, url, lineNo, columnNo, error) {
  console.error('[Worker] Global error:', msg, 'at', lineNo, ':', columnNo, error)
  return false
}

// Message types
type WorkerRequest = {
  id: string
  type: 'generate'
  text: string
  modelType?: TTSModelType
  voice?: string
  speed?: number
  pitch?: number
  language?: string
  /** Knobs only some engines understand. */
  config?: TTSEngineConfig
}

type ChunkProgress = {
  current: number
  total: number
}

type WorkerResponse = {
  id: string
  type:
    | 'success'
    | 'error'
    | 'progress'
    | 'ready'
    | 'chunk-progress'
    | 'complete'
    | 'complete-segments'
  data?: ArrayBuffer
  blob?: Blob
  // Transferable alternatives to Blob — avoids copying on postMessage
  audioBuffer?: ArrayBuffer
  segments?: { text: string; blob: Blob }[]
  segmentBuffers?: { text: string; buffer: ArrayBuffer }[]
  error?: string
  message?: string
  chunkProgress?: ChunkProgress
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const {
    id,
    type,
    text,
    modelType = 'kokoro',
    voice,
    speed,
    pitch,
    language,
    config = {},
  } = event.data

  console.log('[Worker] Received message:', type, id)

  if (type === 'generate') {
    try {
      logger.info(`[Worker] Generating with ${modelType}`)

      // Get the appropriate TTS engine. The engine owns its own configuration.
      const engine = await getTTSEngine(modelType, config)

      // Generate audio with chunk progress tracking
      const blob = await engine.generateVoice(
        {
          text,
          voice,
          speed,
          pitch,
          language,
        },
        (current, total) => {
          // Send chunk progress update
          self.postMessage({
            id,
            type: 'chunk-progress',
            chunkProgress: { current, total },
          } as WorkerResponse)
        },
        (status) => {
          // Send general progress update (model loading, etc)
          self.postMessage({
            id,
            type: 'progress',
            message: status,
          } as WorkerResponse)
        }
      )

      // Validate output
      if (blob.size === 0) {
        throw new Error('Generated audio is empty')
      }

      // Send success response — transfer the ArrayBuffer (zero-copy) instead of
      // posting a Blob, which would be serialised/copied on Android and double
      // peak memory usage per segment.
      const audioBuffer = await blob.arrayBuffer()
      self.postMessage({ id, type: 'complete', audioBuffer } as WorkerResponse, {
        transfer: [audioBuffer],
      })
    } catch (error) {
      console.error('[Worker] Generation error:', error)
      // Send error response
      self.postMessage({
        id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      } as WorkerResponse)
    }
  } else if (type === 'generate-segments') {
    try {
      const engine = await getTTSEngine(modelType, config)

      if (!engine.generateSegments) {
        throw new Error(`Model ${modelType} does not support segment generation`)
      }

      const segments = await engine.generateSegments(
        {
          text,
          voice,
          speed,
          pitch,
          language,
        },
        (current, total) => {
          self.postMessage({
            id,
            type: 'chunk-progress',
            chunkProgress: { current, total },
          } as WorkerResponse)
        },
        (status) => {
          self.postMessage({
            id,
            type: 'progress',
            message: status,
          } as WorkerResponse)
        }
      )

      // Convert segment blobs to transferable ArrayBuffers (zero-copy on postMessage)
      const segmentBuffers: { text: string; buffer: ArrayBuffer }[] = await Promise.all(
        segments.map(async (s) => ({ text: s.text, buffer: await s.blob.arrayBuffer() }))
      )
      const transferList = segmentBuffers.map((s) => s.buffer)
      self.postMessage({ id, type: 'complete-segments', segmentBuffers } as WorkerResponse, {
        transfer: transferList,
      })
    } catch (error) {
      console.error('[Worker] Segment generation error:', error)
      self.postMessage({
        id,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      } as WorkerResponse)
    }
  }
}

// Signal that worker is ready
console.log('[Worker] Sending ready signal')
self.postMessage({ type: 'ready' })
