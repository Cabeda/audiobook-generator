/*
 * TTS Worker Manager
 * Single authoritative implementation.
 */

import logger from './utils/logger'
import type { TTSModelType } from './tts/ttsModels'
import { retryWithBackoff, isRetryableError } from './retryUtils'
import { normalizeError, CancellationError } from './errors'

type WorkerRequest = {
  id: string
  type: 'generate' | 'generate-segments'
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

type WorkerResponse =
  | { id: string; type: 'ready' }
  | { id: string; type: 'success'; data: ArrayBuffer }
  | { id: string; type: 'complete'; blob: Blob }
  | { id: string; type: 'complete-segments'; segments: { text: string; blob: Blob }[] }
  | { id: string; type: 'error'; error?: string }
  | { id: string; type: 'progress'; message?: string }
  | { id: string; type: 'chunk-progress'; chunkProgress: { current: number; total: number } }

type PendingRequest = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (result: any) => void
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
  private isRestarting = false

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
            case 'complete': {
              const resp = data as Extract<WorkerResponse, { type: 'complete' }>
              pending.resolve(resp.blob)
              this.pendingRequests.delete(id)
              break
            }
            case 'complete-segments': {
              const resp = data as Extract<WorkerResponse, { type: 'complete-segments' }>
              pending.resolve(resp.segments)
              this.pendingRequests.delete(id)
              break
            }
            case 'error': {
              const resp = data as Extract<WorkerResponse, { type: 'error' }>
              logger.error('[TTSWorker] error from worker:', resp.error)
              const err = new Error(resp.error || 'Unknown worker error')
              const respAny = resp as unknown as { message?: string }
              if (respAny.message) {
                try {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  err.stack = respAny.message
                } catch (e) {
                  alert(e)
                }
              }
              pending.reject(err)
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
          logger.error('TTS worker error', err)
        }

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
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    model?: string
    device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
  }): Promise<Blob> {
    // Helper to execute the request
    const execute = async () => {
      await this.readyPromise
      if (!this.worker) throw new Error('Worker not initialized')

      const id = `req_${++this.requestCounter}`

      return new Promise<Blob>((resolve, reject) => {
        this.pendingRequests.set(id, {
          resolve,
          reject,
          onProgress: options.onProgress,
          onChunkProgress: options.onChunkProgress,
        })
        const modelType = options.modelType

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
          device: options.device,
        }

        this.worker!.postMessage(request)
      })
    }

    // Use retry with backoff for generation
    return retryWithBackoff(execute, {
      maxRetries: 2,
      initialDelay: 1000,
      maxDelay: 5000,
      shouldRetry: (error: Error) => {
        const errorMsg = error.message
        // Check for memory allocation errors, session creation errors, or WASM aborts
        const isMemoryError =
          errorMsg.includes('failed to allocate') ||
          errorMsg.includes("Can't create a session") ||
          errorMsg.includes('Out of memory') ||
          errorMsg.includes('Aborted()')

        if (isMemoryError) {
          logger.warn('[TTSWorkerManager] Memory error detected, will retry with worker restart')
          // Synchronize worker restart to avoid race conditions
          if (!this.isRestarting) {
            this.isRestarting = true
            this.terminate()
            this.readyPromise = this.initWorker()
              .catch((err) => {
                logger.error('[TTSWorkerManager] Worker restart failed:', err)
                throw err
              })
              .finally(() => {
                this.isRestarting = false
              })
          }
          return true
        }

        // Use standard retry logic for other errors
        return isRetryableError(error)
      },
      onRetry: (attempt, maxRetries, error) => {
        logger.warn(`[TTSWorkerManager] Retry attempt ${attempt}/${maxRetries}:`, error.message)
        if (options.onProgress) {
          options.onProgress(`Retrying... (attempt ${attempt}/${maxRetries})`)
        }
      },
    }).catch((error) => {
      // Convert to structured error
      const normalized = normalizeError(error, 'TTS generation')
      if (options.onProgress) {
        options.onProgress(normalized.getUserMessage())
      }
      throw normalized
    })
  }

  async generateSegments(options: {
    text: string
    modelType?: TTSModelType
    voice?: string
    speed?: number
    pitch?: number
    onProgress?: (message: string) => void
    onChunkProgress?: (current: number, total: number) => void
    dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
    model?: string
    device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
  }): Promise<{ text: string; blob: Blob }[]> {
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
      const modelType = options.modelType

      const request: WorkerRequest = {
        id,
        type: 'generate-segments',
        text: options.text,
        modelType: modelType,
        voice: options.voice,
        speed: options.speed,
        pitch: options.pitch,
        dtype: options.dtype,
        model: options.model,
        device: options.device,
      }

      this.worker!.postMessage(request)
    })
  }

  cancelAll() {
    // Reject pending promises with CancellationError
    const cancellationError = new CancellationError('TTS generation cancelled by user')
    this.pendingRequests.forEach((p) => p.reject(cancellationError))
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
