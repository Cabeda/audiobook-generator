/*
 * TTS Worker Manager
 * Single authoritative implementation.
 */

import logger from './utils/logger'
import type { TTSModelType } from './tts/ttsModels'
import { retryWithBackoff, isRetryableError } from './retryUtils'
import { normalizeError, CancellationError } from './errors'
import { toastStore } from '../stores/toastStore'

type WorkerRequest = {
  id: string
  type: 'generate' | 'generate-segments'
  text: string
  modelType?: TTSModelType
  voice?: string
  speed?: number
  pitch?: number
  language?: string // ISO 639-1 language code for voice selection
  // Kokoro-specific
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  model?: string
  device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
  advancedSettings?: Record<string, any>
}

type WorkerResponse =
  | { id: string; type: 'ready' }
  | { id: string; type: 'success'; data: ArrayBuffer }
  | { id: string; type: 'complete'; blob: Blob }
  | { id: string; type: 'complete'; audioBuffer: ArrayBuffer }
  | { id: string; type: 'complete-segments'; segments: { text: string; blob: Blob }[] }
  | {
      id: string
      type: 'complete-segments'
      segmentBuffers: { text: string; buffer: ArrayBuffer }[]
    }
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

type GenerateOptions = {
  text: string
  modelType?: TTSModelType
  voice?: string
  speed?: number
  pitch?: number
  language?: string
  onProgress?: (message: string) => void
  onChunkProgress?: (current: number, total: number) => void
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  model?: string
  device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
  advancedSettings?: Record<string, any>
}

/** Default timeout for individual TTS requests (2 minutes) */
const REQUEST_TIMEOUT_MS = 120_000

/** Maximum number of queued requests before rejecting new ones */
const MAX_QUEUE_DEPTH = 50

/**
 * Compute an adaptive timeout for a TTS request based on text length.
 * Base: 2 minutes. Add 1 second per 10 characters beyond 200 chars, capped at 10 minutes.
 * This prevents false timeouts on long sentences (e.g. 200-word run-ons) while
 * still catching genuinely hung requests.
 */
function adaptiveTimeout(text: string): number {
  const base = REQUEST_TIMEOUT_MS
  const extra = Math.max(0, text.length - 200) * 100 // 100ms per char over 200
  return Math.min(base + extra, 600_000) // cap at 10 minutes
}

function isMemoryError(msg: string): boolean {
  return (
    msg.includes('failed to allocate') ||
    msg.includes("Can't create a session") ||
    msg.includes('Out of memory') ||
    msg.includes('Aborted()')
  )
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
              // Worker sends a transferable ArrayBuffer (zero-copy). Fall back to
              // Blob for older builds that may still send the legacy shape.
              let blob: Blob
              if ('audioBuffer' in resp && resp.audioBuffer instanceof ArrayBuffer) {
                blob = new Blob([resp.audioBuffer], { type: 'audio/wav' })
              } else {
                blob = (resp as Extract<WorkerResponse, { type: 'complete'; blob: Blob }>).blob
              }
              pending.resolve(blob)
              this.pendingRequests.delete(id)
              break
            }
            case 'complete-segments': {
              const resp = data as Extract<WorkerResponse, { type: 'complete-segments' }>
              // Worker sends transferable ArrayBuffers. Fall back to Blob segments.
              let segments: { text: string; blob: Blob }[]
              if ('segmentBuffers' in resp && Array.isArray(resp.segmentBuffers)) {
                segments = resp.segmentBuffers.map((s) => ({
                  text: s.text,
                  blob: new Blob([s.buffer], { type: 'audio/wav' }),
                }))
              } else {
                segments = (
                  resp as Extract<
                    WorkerResponse,
                    { type: 'complete-segments'; segments: { text: string; blob: Blob }[] }
                  >
                ).segments
              }
              pending.resolve(segments)
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
                  toastStore.error(String(e))
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
          logger.error('TTS worker error event:', err)
          console.error('TTS worker internal error:', err.message, err.filename, err.lineno)
          // Reject all pending requests immediately so callers don't hang until timeout.
          // This is critical on Android where the worker can be killed by the OS OOM killer
          // mid-request — without this, every pending request would silently wait up to
          // 10 minutes before timing out.
          const workerCrashError = new Error(
            `TTS worker crashed: ${err.message || 'unknown error'}`
          )
          this.pendingRequests.forEach((p) => p.reject(workerCrashError))
          this.pendingRequests.clear()
          this.ready = false
          // Terminate the dead worker and schedule a fresh one so the next request
          // can succeed after the OS reclaims memory.
          if (this.worker) {
            try {
              this.worker.terminate()
            } catch {
              // ignore — worker may already be dead
            }
            this.worker = null
          }
          this.readyPromise = this.initWorker()
        }

        setTimeout(() => {
          if (!this.ready) reject(new Error('Worker initialization timeout'))
        }, 30_000)
      } catch (err) {
        reject(err as Error)
      }
    })
  }

  /** Restart the worker on memory errors, waiting if a restart is already in progress. */
  private async restartWorkerIfNeeded(): Promise<void> {
    if (!this.isRestarting) {
      this.isRestarting = true
      this.terminate()
      try {
        this.readyPromise = this.initWorker()
        await this.readyPromise
      } catch (err) {
        logger.error('[TTSWorkerManager] Worker restart failed:', err)
        throw err
      } finally {
        this.isRestarting = false
      }
    } else {
      // Another restart is already in progress — just wait for it
      try {
        await this.readyPromise
      } catch (err) {
        logger.error('[TTSWorkerManager] Worker restart failed during wait:', err)
        throw err
      }
    }
  }

  /**
   * Dispatch a request to the worker and return a promise that resolves with the result.
   * Enforces queue depth limit (waits with backpressure instead of hard-rejecting) and
   * uses an adaptive per-request timeout based on text length.
   */
  private async dispatch<T>(
    request: Omit<WorkerRequest, 'id'>,
    options: Pick<GenerateOptions, 'onProgress' | 'onChunkProgress'>
  ): Promise<T> {
    // Backpressure: wait until the queue has room rather than hard-rejecting.
    // Poll every 500ms; give up after 60s to avoid infinite waits.
    const backpressureStart = Date.now()
    while (this.pendingRequests.size >= MAX_QUEUE_DEPTH) {
      if (Date.now() - backpressureStart > 60_000) {
        return Promise.reject(
          new Error(`TTS worker queue full (max ${MAX_QUEUE_DEPTH}) — timed out waiting for slot`)
        )
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    const id = `req_${++this.requestCounter}`
    const timeoutMs = adaptiveTimeout(request.text)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`TTS request timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
        onProgress: options.onProgress,
        onChunkProgress: options.onChunkProgress,
      })

      this.worker!.postMessage({ id, ...request })
    })
  }

  /** Shared retry wrapper used by both generateVoice and generateSegments. */
  private withRetry<T>(
    label: string,
    execute: () => Promise<T>,
    onProgress?: (msg: string) => void
  ): Promise<T> {
    return retryWithBackoff(execute, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 5000,
      shouldRetry: (error: Error) => {
        if (isMemoryError(error.message)) {
          logger.warn(`[TTSWorkerManager] Memory error in ${label}, will retry with worker restart`)
          return true
        }
        return isRetryableError(error)
      },
      onRetry: async (attempt, maxRetries, error) => {
        logger.warn(`[TTSWorkerManager] ${label} retry ${attempt}/${maxRetries}:`, error.message)
        if (isMemoryError(error.message)) {
          logger.warn(`[TTSWorkerManager] Restarting worker due to memory error in ${label}`)
          await this.restartWorkerIfNeeded()
        }
        if (onProgress) onProgress(`Retrying... (attempt ${attempt}/${maxRetries})`)
      },
    }).catch((error) => {
      const normalized = normalizeError(error, label)
      if (onProgress) onProgress(normalized.getUserMessage())
      throw normalized
    })
  }

  async generateVoice(options: GenerateOptions): Promise<Blob> {
    return this.withRetry(
      'TTS generation',
      async () => {
        await this.readyPromise
        if (!this.worker) throw new Error('Worker not initialized')
        return this.dispatch<Blob>(
          {
            type: 'generate',
            text: options.text,
            modelType: options.modelType,
            voice: options.voice,
            speed: options.speed,
            pitch: options.pitch,
            language: options.language,
            dtype: options.dtype,
            model: options.model,
            device: options.device,
            advancedSettings: options.advancedSettings,
          },
          { onProgress: options.onProgress, onChunkProgress: options.onChunkProgress }
        )
      },
      options.onProgress
    )
  }

  async generateSegments(
    options: Omit<GenerateOptions, 'advancedSettings'>
  ): Promise<{ text: string; blob: Blob }[]> {
    return this.withRetry(
      'TTS segment generation',
      async () => {
        await this.readyPromise
        if (!this.worker) throw new Error('Worker not initialized')
        return this.dispatch<{ text: string; blob: Blob }[]>(
          {
            type: 'generate-segments',
            text: options.text,
            modelType: options.modelType,
            voice: options.voice,
            speed: options.speed,
            pitch: options.pitch,
            language: options.language,
            dtype: options.dtype,
            model: options.model,
            device: options.device,
          },
          { onProgress: options.onProgress, onChunkProgress: options.onChunkProgress }
        )
      },
      options.onProgress
    )
  }

  cancelAll() {
    const cancellationError = new CancellationError('TTS generation cancelled by user')
    this.pendingRequests.forEach((p) => p.reject(cancellationError))
    this.pendingRequests.clear()

    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }

    this.ready = false
    this.readyPromise = this.initWorker()
  }

  terminate() {
    const terminationError = new Error('TTS worker terminated')
    this.pendingRequests.forEach((p) => p.reject(terminationError))
    this.pendingRequests.clear()

    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
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
