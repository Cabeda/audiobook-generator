/**
 * Web Worker for TTS generation to prevent UI blocking
 * This worker handles the heavy ONNX model inference off the main thread
 */

import { generateVoice, type VoiceId } from './lib/kokoro/kokoroClient.ts'

// Message types
type WorkerRequest = {
  id: string
  type: 'generate'
  text: string
  voice?: VoiceId
  speed?: number
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
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
  const { id, type, text, voice, speed } = event.data

  if (type === 'generate') {
    try {
      // Send progress update
      self.postMessage({
        id,
        type: 'progress',
        message: 'Loading model...',
      } as WorkerResponse)

      // Generate audio with chunk progress tracking
      // Forward dtype if provided so the model can be loaded with the desired quantization
      const req = event.data as WorkerRequest
      const params: {
        text: string
        voice?: VoiceId
        speed?: number
        model?: string
        dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
      } = { text, voice, speed }

      if (req.dtype) params.dtype = req.dtype

      const blob = await generateVoice(params, (current, total) => {
        // Send chunk progress update
        self.postMessage({
          id,
          type: 'chunk-progress',
          chunkProgress: { current, total },
        } as WorkerResponse)
      })

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
      // Send error response
      self.postMessage({
        id,
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      } as WorkerResponse)
    }
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
