/**
 * A GPU that cannot run the model.
 *
 * Some machines hand out a WebGPU adapter and then fail at inference with an
 * ONNX Runtime error. The failed model session stays in the worker, so asking
 * the same worker for the CPU path does not help: the worker has to be
 * replaced, and the retry has to ask for the CPU.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../tts.worker.ts', () => ({}))

/** Every request the manager posted, worker by worker. */
const posted: Array<{ worker: number; message: { type?: string; config?: { device?: string } } }> =
  []
let workers = 0

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private readonly id: number

  constructor() {
    this.id = ++workers
    setTimeout(() => this.onmessage?.({ data: { type: 'ready' } } as MessageEvent), 0)
  }

  postMessage(message: { id?: string; type?: string; config?: { device?: string } }) {
    posted.push({ worker: this.id, message })
    if (!message.id) return

    const device = message.config?.device
    setTimeout(() => {
      if (device === 'wasm') {
        this.onmessage?.({
          data: { id: message.id, type: 'complete', audioBuffer: new ArrayBuffer(8) },
        } as MessageEvent)
      } else {
        this.onmessage?.({
          data: {
            id: message.id,
            type: 'error',
            error:
              'Failed to generate speech: failed to call OrtRun(). ERROR_CODE: 1, ' +
              'ERROR_MESSAGE: /onnxruntime/core/providers/webgpu/program.cc:247 ' +
              'Cannot reduce shape {1,512,19} by component=4',
          },
        } as MessageEvent)
      }
    }, 0)
  }

  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}

describe('A GPU that cannot run the model', () => {
  beforeEach(() => {
    posted.length = 0
    workers = 0
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes the speech on the CPU in a fresh worker, and stays there', async () => {
    const { TTSWorkerManager } = await import('./ttsWorkerManager')
    const manager = new TTSWorkerManager()

    const blob = await manager.generateVoice({
      text: 'Hello there.',
      modelType: 'kokoro',
      config: { device: 'auto' },
    })

    expect(blob).toBeInstanceOf(Blob)
    // The first worker was asked on auto and refused; the retry went to a new
    // worker asking for the CPU.
    expect(workers).toBe(2)
    const generate = posted.filter((request) => request.message.type === 'generate')
    expect(generate.map((request) => request.message.config?.device)).toEqual(['auto', 'wasm'])
    expect(generate[1].worker).toBe(2)

    // Later segments do not pay for the GPU again.
    await manager.generateVoice({
      text: 'And another.',
      modelType: 'kokoro',
      config: { device: 'auto' },
    })
    expect(workers).toBe(2)
    const after = posted.filter((request) => request.message.type === 'generate')
    expect(after.at(-1)?.message.config?.device).toBe('wasm')
  })
})
