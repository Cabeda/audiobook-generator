/**
 * Web Worker for TTS generation to prevent UI blocking
 * This worker handles TTS generation off the main thread
 */

import { getTTSEngine, type TTSModelType } from './lib/tts/ttsModels.ts'

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
}

type ChunkProgress = {
  current: number
  total: number
}

type WorkerResponse = {
  id: string
  type: 'success' | 'error' | 'progress' | 'ready' | 'chunk-progress'
  data?: ArrayBuffer
  error?: string
  message?: string
  chunkProgress?: ChunkProgress
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, text, modelType = 'kokoro', voice, speed, pitch, model, dtype } = event.data

  if (type === 'generate') {
    try {
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
        },
        (current, total) => {
          // Send chunk progress update
          self.postMessage({
            id,
            type: 'chunk-progress',
            chunkProgress: { current, total },
          } as WorkerResponse)
        }
      )

      // Convert blob to ArrayBuffer for transfer
      const arrayBuffer = await blob.arrayBuffer()

      // Send success response with transferable ArrayBuffer
      self.postMessage(
        {
          id,
          type: 'success',
          data: arrayBuffer,
        } as WorkerResponse,
        { transfer: [arrayBuffer] }
      )
    } catch (error) {
      // Send error response with optional stack if available
      const errMsg = error instanceof Error ? error.message : String(error)
      const errStack = error instanceof Error ? error.stack : undefined
      self.postMessage({
        id,
        type: 'error',
        error: errMsg,
        message: errStack,
      } as WorkerResponse)
    }
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
