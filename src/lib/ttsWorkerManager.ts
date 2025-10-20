/**
 * TTS Worker Manager
 * Manages Web Worker for TTS generation to prevent UI blocking
 */

import type { VoiceId } from './kokoro/kokoroClient.ts'

type WorkerRequest = {
  id: string
  type: 'generate'
  text: string
  voice?: VoiceId
  speed?: number
}

type WorkerResponse = {
  id: string
  type: 'success' | 'error' | 'progress' | 'ready'
  data?: ArrayBuffer
  error?: string
  message?: string
}

type PendingRequest = {
  resolve: (blob: Blob) => void
  reject: (error: Error) => void
  onProgress?: (message: string) => void
}

export class TTSWorkerManager {
  private worker: Worker | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private requestCounter = 0
  private ready = false
  private readyPromise: Promise<void>

  constructor() {
    this.readyPromise = this.initWorker()
  }

  private initWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create worker using dynamic import
        this.worker = new Worker(
          new URL('../tts.worker.ts', import.meta.url),
          { type: 'module' }
        )

        if (!this.worker) {
          reject(new Error('Failed to create worker'))
          return
        }

        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const { id, type, data, error, message } = event.data

          if (type === 'ready') {
            this.ready = true
            resolve()
            return
          }

          const pending = this.pendingRequests.get(id)
          if (!pending) return

          switch (type) {
            case 'success':
              if (data) {
                // Convert ArrayBuffer back to Blob
                const blob = new Blob([data], { type: 'audio/wav' })
                pending.resolve(blob)
                this.pendingRequests.delete(id)
              }
              break

            case 'error':
              pending.reject(new Error(error || 'Unknown worker error'))
              this.pendingRequests.delete(id)
              break

            case 'progress':
              if (message && pending.onProgress) {
                pending.onProgress(message)
              }
              break
          }
        }

        this.worker.onerror = (error) => {
          console.error('Worker error:', error)
          reject(new Error('Failed to initialize TTS worker'))
        }

        // Timeout if worker doesn't become ready
        setTimeout(() => {
          if (!this.ready) {
            reject(new Error('Worker initialization timeout'))
          }
        }, 30000) // 30 second timeout
      } catch (err) {
        reject(err)
      }
    })
  }

  async generateVoice(options: {
    text: string
    voice?: VoiceId
    speed?: number
    onProgress?: (message: string) => void
  }): Promise<Blob> {
    // Wait for worker to be ready
    await this.readyPromise

    if (!this.worker) {
      throw new Error('Worker not initialized')
    }

    const id = `req_${++this.requestCounter}`

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress
      })

      const request: WorkerRequest = {
        id,
        type: 'generate',
        text: options.text,
        voice: options.voice,
        speed: options.speed
      }

      this.worker!.postMessage(request)
    })
  }

  cancelAll() {
    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error('Cancelled by user'))
    })
    this.pendingRequests.clear()
    
    // Terminate and recreate worker to stop any ongoing work
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.ready = false
    this.readyPromise = this.initWorker()
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.pendingRequests.clear()
    this.ready = false
  }
}

// Singleton instance
let workerManager: TTSWorkerManager | null = null

export function getTTSWorker(): TTSWorkerManager {
  if (!workerManager) {
    workerManager = new TTSWorkerManager()
  }
  return workerManager
}

export function terminateTTSWorker() {
  if (workerManager) {
    workerManager.terminate()
    workerManager = null
  }
}
