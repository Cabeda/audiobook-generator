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
}

type WorkerResponse = {
  id: string
  type: 'success' | 'error' | 'progress'
  data?: ArrayBuffer
  error?: string
  message?: string
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
        message: 'Loading model...'
      } as WorkerResponse)

      // Generate audio
      const blob = await generateVoice({ text, voice, speed })
      
      // Convert blob to ArrayBuffer for transfer
      const arrayBuffer = await blob.arrayBuffer()
      
      // Send success response with transferable ArrayBuffer
      self.postMessage({
        id,
        type: 'success',
        data: arrayBuffer
      } as WorkerResponse, { transfer: [arrayBuffer] })
      
    } catch (error) {
      // Send error response
      self.postMessage({
        id,
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      } as WorkerResponse)
    }
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
