/**
 * TTS Client Mock Factories
 *
 * Provides configurable mocks for TTS clients (Kokoro, Piper) and the TTS Worker Manager.
 * These mocks allow testing at the TTS client boundary without loading actual WASM/ONNX models.
 */

import { vi } from 'vitest'

// ============================================================================
// Types
// ============================================================================

export interface MockTTSOptions {
  /** Delay in ms before resolving generate calls */
  generateDelay?: number
  /** If true, generate calls will reject with an error */
  shouldFail?: boolean
  /** Custom error message when shouldFail is true */
  errorMessage?: string
  /** Number of segments to return for segmented generation */
  segmentCount?: number
  /** Duration of each mock audio segment in ms */
  audioDurationMs?: number
  /** If true, simulates a timeout (never resolves) */
  simulateTimeout?: boolean
  /** If provided, fail after this many successful calls */
  failAfterCalls?: number
  /** If true, simulates memory errors that trigger worker restart */
  simulateMemoryError?: boolean
}

export interface MockStreamChunk {
  text: string
  phonemes: string
  audio: { toBlob: () => Blob }
}

// ============================================================================
// WAV Buffer Creation
// ============================================================================

/**
 * Creates a valid WAV buffer for testing
 */
export function createMockWavBuffer(durationMs: number = 100): ArrayBuffer {
  const sampleRate = 24000
  const numChannels = 1
  const bitsPerSample = 16
  const numSamples = Math.floor((sampleRate * durationMs) / 1000)
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const bufferSize = 44 + dataSize
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, bufferSize - 8, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)

  // Fill with silence (zeros)
  for (let i = 44; i < bufferSize; i++) {
    view.setUint8(i, 0)
  }

  return buffer
}

/**
 * Creates a mock WAV Blob
 */
export function createMockWavBlob(durationMs: number = 100): Blob {
  return new Blob([createMockWavBuffer(durationMs)], { type: 'audio/wav' })
}

// ============================================================================
// Kokoro Client Mocks
// ============================================================================

/**
 * Creates a mock KokoroTTS instance
 */
export function createMockKokoroTTS(options: MockTTSOptions = {}) {
  const {
    generateDelay = 10,
    shouldFail = false,
    errorMessage = 'Mock TTS generation failed',
    audioDurationMs = 100,
    simulateTimeout = false,
    failAfterCalls = Infinity,
    simulateMemoryError = false,
  } = options

  let callCount = 0

  const createMockAudio = (_text: string) => ({
    toBlob: () => createMockWavBlob(audioDurationMs),
  })

  const generate = vi.fn().mockImplementation(async (text: string) => {
    callCount++

    if (simulateTimeout) {
      return new Promise(() => {}) // Never resolves
    }

    if (generateDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, generateDelay))
    }

    if (simulateMemoryError) {
      throw new Error('failed to allocate memory')
    }

    if (shouldFail || callCount > failAfterCalls) {
      throw new Error(errorMessage)
    }

    return createMockAudio(text)
  })

  const stream = vi.fn().mockImplementation(function (_splitter: {
    push: (text: string) => void
    close: () => void
  }) {
    return (async function* () {
      if (shouldFail) {
        throw new Error(errorMessage)
      }

      yield {
        text: 'Mock sentence.',
        phonemes: 'mɑk sˈɛntəns',
        audio: createMockAudio('Mock sentence.'),
      }
    })()
  })

  const list_voices = vi
    .fn()
    .mockReturnValue(['af_heart', 'af_alloy', 'am_adam', 'bf_emma', 'bm_george'])

  return {
    generate,
    stream,
    list_voices,
    voices: {
      af_heart: { name: 'Heart', language: 'en' },
      af_alloy: { name: 'Alloy', language: 'en' },
      am_adam: { name: 'Adam', language: 'en' },
      bf_emma: { name: 'Emma', language: 'en' },
      bm_george: { name: 'George', language: 'en' },
    },
    // Test helpers
    _resetCallCount: () => {
      callCount = 0
    },
    _getCallCount: () => callCount,
  }
}

/**
 * Creates a mock for the kokoro-js module
 */
export function createMockKokoroModule(options: MockTTSOptions = {}) {
  const mockTTS = createMockKokoroTTS(options)

  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue(mockTTS),
    },
    TextSplitterStream: vi.fn().mockImplementation(function (this: {
      chunks: string[]
      closed: boolean
    }) {
      this.chunks = []
      this.closed = false
      return {
        push: (text: string) => {
          this.chunks.push(text)
        },
        close: () => {
          this.closed = true
        },
      }
    }),
    // Expose mock TTS for test assertions
    _mockTTS: mockTTS,
  }
}

// ============================================================================
// Piper Client Mocks
// ============================================================================

export interface MockPiperVoice {
  key: string
  name: string
  language: string
  quality: string
}

/**
 * Default mock Piper voices
 */
export const mockPiperVoices: MockPiperVoice[] = [
  { key: 'en_US-lessac-medium', name: 'Lessac', language: 'en-US', quality: 'medium' },
  { key: 'en_GB-alba-medium', name: 'Alba', language: 'en-GB', quality: 'medium' },
  { key: 'de_DE-thorsten-medium', name: 'Thorsten', language: 'de-DE', quality: 'medium' },
  { key: 'fr_FR-siwis-medium', name: 'Siwis', language: 'fr-FR', quality: 'medium' },
  { key: 'pt_PT-tugao-medium', name: 'Tugao', language: 'pt-PT', quality: 'medium' },
]

/**
 * Creates a mock PiperClient instance
 */
export function createMockPiperClient(options: MockTTSOptions = {}) {
  const {
    generateDelay = 10,
    shouldFail = false,
    errorMessage = 'Mock Piper generation failed',
    audioDurationMs = 100,
    failAfterCalls = Infinity,
  } = options

  let callCount = 0

  const getVoices = vi.fn().mockResolvedValue(mockPiperVoices)

  const generateSpeech = vi.fn().mockImplementation(async (_text: string, _voiceId: string) => {
    callCount++

    if (generateDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, generateDelay))
    }

    if (shouldFail || callCount > failAfterCalls) {
      throw new Error(errorMessage)
    }

    return createMockWavBlob(audioDurationMs)
  })

  return {
    getVoices,
    generateSpeech,
    // Test helpers
    _resetCallCount: () => {
      callCount = 0
    },
    _getCallCount: () => callCount,
  }
}

/**
 * Creates a mock for @diffusionstudio/vits-web module
 */
export function createMockVitsModule(options: MockTTSOptions = {}) {
  const {
    generateDelay = 10,
    shouldFail = false,
    errorMessage = 'Mock VITS generation failed',
    audioDurationMs = 100,
  } = options

  return {
    predict: vi.fn().mockImplementation(async () => {
      if (generateDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, generateDelay))
      }

      if (shouldFail) {
        throw new Error(errorMessage)
      }

      return createMockWavBlob(audioDurationMs)
    }),
    voiceList: vi
      .fn()
      .mockResolvedValue([{ key: 'en_US-lessac-medium', name: 'Lessac', language: 'en-US' }]),
    stored: vi.fn().mockResolvedValue([]),
    download: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  }
}

// ============================================================================
// TTS Worker Manager Mocks
// ============================================================================

export interface MockWorkerOptions extends MockTTSOptions {
  /** If true, worker initialization fails */
  initFails?: boolean
  /** Delay before worker becomes ready (unused but kept for API compatibility) */
  readyDelay?: number
}

/**
 * Creates a mock TTSWorkerManager
 */
export function createMockTTSWorkerManager(options: MockWorkerOptions = {}) {
  const {
    generateDelay = 10,
    shouldFail = false,
    errorMessage = 'Mock worker generation failed',
    audioDurationMs = 100,
    initFails = false,
    // readyDelay is accepted but not used (kept for API compatibility)
    failAfterCalls = Infinity,
    simulateMemoryError = false,
    simulateTimeout = false,
  } = options

  let callCount = 0
  let ready = !initFails
  let terminated = false

  const pendingRequests = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  const generateVoice = vi
    .fn()
    .mockImplementation(
      async (opts: {
        text: string
        onProgress?: (msg: string) => void
        onChunkProgress?: (current: number, total: number) => void
      }) => {
        callCount++

        if (terminated) {
          throw new Error('Worker terminated')
        }

        if (simulateTimeout) {
          return new Promise(() => {}) // Never resolves
        }

        if (generateDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, generateDelay))
        }

        if (simulateMemoryError) {
          throw new Error('failed to allocate memory')
        }

        if (shouldFail || callCount > failAfterCalls) {
          throw new Error(errorMessage)
        }

        opts.onProgress?.('Generating audio...')
        opts.onChunkProgress?.(1, 1)

        return createMockWavBlob(audioDurationMs)
      }
    )

  const generateSegments = vi
    .fn()
    .mockImplementation(
      async (_opts: {
        text: string
        onProgress?: (msg: string) => void
        onChunkProgress?: (current: number, total: number) => void
      }) => {
        if (terminated) {
          throw new Error('Worker terminated')
        }

        if (generateDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, generateDelay))
        }

        if (shouldFail) {
          throw new Error(errorMessage)
        }

        return [
          { text: 'First segment.', blob: createMockWavBlob(audioDurationMs) },
          { text: 'Second segment.', blob: createMockWavBlob(audioDurationMs) },
        ]
      }
    )

  const cancelAll = vi.fn().mockImplementation(() => {
    pendingRequests.forEach((p) => p.reject(new Error('Cancelled')))
    pendingRequests.clear()
  })

  const terminate = vi.fn().mockImplementation(() => {
    terminated = true
    cancelAll()
  })

  return {
    generateVoice,
    generateSegments,
    cancelAll,
    terminate,
    // Test helpers
    _isReady: () => ready,
    _isTerminated: () => terminated,
    _resetCallCount: () => {
      callCount = 0
    },
    _getCallCount: () => callCount,
    _setReady: (value: boolean) => {
      ready = value
    },
  }
}

/**
 * Sets up the TTS worker manager mock at the module level
 */
export function setupTTSWorkerManagerMock(options: MockWorkerOptions = {}) {
  const mockManager = createMockTTSWorkerManager(options)

  vi.mock('../lib/ttsWorkerManager', () => ({
    getTTSWorker: vi.fn(() => mockManager),
    terminateTTSWorker: vi.fn(() => mockManager.terminate()),
  }))

  return mockManager
}

// ============================================================================
// Combined Mock Setup
// ============================================================================

/**
 * Sets up all TTS-related mocks for comprehensive testing
 */
export function setupAllTTSMocks(options: MockTTSOptions = {}) {
  const kokoroModule = createMockKokoroModule(options)
  const vitsModule = createMockVitsModule(options)
  const workerManager = createMockTTSWorkerManager(options)

  return {
    kokoro: kokoroModule,
    vits: vitsModule,
    worker: workerManager,
  }
}

// ============================================================================
// Error Simulation Helpers
// ============================================================================

/**
 * Creates a mock that fails with specific error types for testing error handling
 */
export function createFailingMock(
  errorType: 'memory' | 'network' | 'timeout' | 'abort' | 'generic'
) {
  const errorMessages: Record<string, string> = {
    memory: 'failed to allocate memory',
    network: 'NetworkError: Failed to fetch',
    timeout: 'Timeout exceeded',
    abort: 'Aborted()',
    generic: 'Unknown error occurred',
  }

  return createMockKokoroTTS({
    shouldFail: true,
    errorMessage: errorMessages[errorType],
    simulateTimeout: errorType === 'timeout',
    simulateMemoryError: errorType === 'memory',
  })
}

/**
 * Creates a mock that succeeds N times then fails
 */
export function createIntermittentFailureMock(
  successCount: number,
  errorMessage = 'Intermittent failure'
) {
  return createMockKokoroTTS({
    failAfterCalls: successCount,
    errorMessage,
  })
}
