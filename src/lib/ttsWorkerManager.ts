/*
 * TTS Worker Manager
 * Single authoritative implementation.
 */

import type { TTSModelType } from './tts/ttsModels'

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

type WorkerResponse =
  | { id: string; type: 'ready' }
  | { id: string; type: 'success'; data: ArrayBuffer }
  | { id: string; type: 'error'; error?: string }
  | { id: string; type: 'progress'; message?: string }
  | { id: string; type: 'chunk-progress'; chunkProgress: { current: number; total: number } }

type PendingRequest = {
  resolve: (blob: Blob) => void
  reject: (err: Error) => void
  onProgress?: (message: string) => void
  onChunkProgress?: (current: number, total: number) => void
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
        this.worker = new Worker(new URL('../tts.worker.ts', import.meta.url), { type: 'module' })

        if (!this.worker) return reject(new Error('Failed to create worker'))

        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          const data = event.data
          const { id, type } = data

          if (type === 'ready') {
            this.ready = true
            resolve()
            return
          }

          const pending = this.pendingRequests.get(id)
          if (!pending) return

          switch (type) {
            case 'success': {
              const resp = data as Extract<WorkerResponse, { type: 'success' }>
              const blob = new Blob([resp.data], { type: 'audio/wav' })
              pending.resolve(blob)
              this.pendingRequests.delete(id)
              break
            }
            case 'error': {
              const resp = data as Extract<WorkerResponse, { type: 'error' }>
              pending.reject(new Error(resp.error || 'Unknown worker error'))
              this.pendingRequests.delete(id)
              break
            }
            case 'progress': {
              const resp = data as Extract<WorkerResponse, { type: 'progress' }>
              if (resp.message && pending.onProgress) pending.onProgress(resp.message)
              break
            }
            case 'chunk-progress': {
              const resp = data as Extract<WorkerResponse, { type: 'chunk-progress' }>
              if (resp.chunkProgress && pending.onChunkProgress) {
                const { current, total } = resp.chunkProgress
                pending.onChunkProgress(current, total)
              }
              break
            }
          }
        }

        this.worker.onerror = (err) => {
          console.error('TTS worker error', err)
        }

        // Safety timeout in case worker doesn't send ready
        setTimeout(() => {
          if (!this.ready) reject(new Error('Worker initialization timeout'))
        }, 30_000)
      } catch (err) {
        reject(err as Error)
      }
    })
  }

  async generateVoice(options: {
    text: string
    modelType?: TTSModelType
    voice?: string
    speed?: number
    pitch?: number
    onProgress?: (message: string) => void
    onChunkProgress?: (current: number, total: number) => void
    // Kokoro-specific
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    model?: string
  }): Promise<Blob> {
    await this.readyPromise

    if (!this.worker) throw new Error('Worker not initialized')

    const id = `req_${++this.requestCounter}`

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject,
        onProgress: options.onProgress,
        onChunkProgress: options.onChunkProgress,
      })
      // If using the Web Speech API, run generation on the main thread because
      // SpeechSynthesis is not available inside Web Workers.
      const modelType = options.modelType || 'webspeech'
      if (modelType === 'webspeech') {
        ;(async () => {
          try {
            const mod = await import('./webspeech/webSpeechClient')
            const blob = await mod.generateVoice(
              {
                text: options.text,
                voice: options.voice,
                speed: options.speed,
                pitch: options.pitch,
              },
              options.onChunkProgress
            )
            // Resolve and cleanup
            const pending = this.pendingRequests.get(id)
            if (pending) {
              pending.resolve(blob)
              this.pendingRequests.delete(id)
            }
          } catch (err) {
            const pending = this.pendingRequests.get(id)
            if (pending) {
              pending.reject(err as Error)
              this.pendingRequests.delete(id)
            }
          }
        })()
        return
      }

      const request: WorkerRequest = {
        id,
        type: 'generate',
        text: options.text,
        modelType: modelType,
        voice: options.voice,
        speed: options.speed,
        pitch: options.pitch,
        dtype: options.dtype,
        model: options.model,
      }

      // Post the request; worker will return an ArrayBuffer which we convert to Blob in onmessage
      this.worker!.postMessage(request)
    })
  }

  cancelAll() {
    // Reject pending promises
    this.pendingRequests.forEach((p) => p.reject(new Error('Cancelled by user')))
    this.pendingRequests.clear()

    // Restart the worker to stop in-progress work
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

// Singleton accessor
let workerManager: TTSWorkerManager | null = null

export function getTTSWorker(): TTSWorkerManager {
  if (!workerManager) workerManager = new TTSWorkerManager()
  return workerManager
}

export function terminateTTSWorker() {
  if (workerManager) {
    workerManager.terminate()
    workerManager = null
  }
}
