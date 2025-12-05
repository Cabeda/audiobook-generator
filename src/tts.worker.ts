import logger from './lib/utils/logger'
import { getTTSEngine, type TTSModelType } from './lib/tts/ttsModels'

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
  // Kokoro-specific
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  model?: string
  device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
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
  segments?: { text: string; blob: Blob }[]
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
    model,
    dtype,
    device = 'auto',
  } = event.data

  console.log('[Worker] Received message:', type, id)

  if (type === 'generate') {
    try {
      // Log device selection
      logger.info(`[Worker] Generating with device: ${device}`)

      // Send progress update
      self.postMessage({
        id,
        type: 'progress',
        message: modelType === 'kokoro' ? 'Preparing...' : 'Initializing speech...',
      } as WorkerResponse)

      // Get the appropriate TTS engine
      const engine = await getTTSEngine(modelType)

      // Generate audio with chunk progress tracking
      const blob = await engine.generateVoice(
        {
          text,
          voice,
          speed,
          pitch,
          model,
          dtype,
          device,
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

      // Send success response
      self.postMessage({
        id,
        type: 'complete',
        blob,
      } as WorkerResponse)
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
      // Send progress update
      self.postMessage({
        id,
        type: 'progress',
        message: modelType === 'kokoro' ? 'Preparing...' : 'Initializing speech...',
      } as WorkerResponse)

      const engine = await getTTSEngine(modelType)

      if (!engine.generateSegments) {
        throw new Error(`Model ${modelType} does not support segment generation`)
      }

      const segments = await engine.generateSegments(
        {
          text,
          voice,
          speed,
          pitch,
          model,
          dtype,
          device,
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

      self.postMessage({
        id,
        type: 'complete-segments',
        segments,
      } as WorkerResponse)
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
