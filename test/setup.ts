import { vi } from 'vitest'

// Global tests setup to prevent loading heavy WASM modules (e.g., phonemizer via kokoro-js)
// across parallel test workers. We provide a minimal, deterministic mock of `kokoro-js`
// that is used by many tests (kokoroClient, integration tests) and removes the
// chance of the Emscripten/phonemizer code being loaded and spawning worker pools.

// Create a minimal WAV buffer (valid header) used by mock audio objects
function createMockWavBuffer(durationMs: number = 100) {
  const sampleRate = 24000
  const numChannels = 1
  const bitsPerSample = 16
  const numSamples = Math.floor((sampleRate * durationMs) / 1000)
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const bufferSize = 44 + dataSize
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false)
  view.setUint32(4, bufferSize - 8, true)
  view.setUint32(8, 0x57415645, false)
  view.setUint32(12, 0x666d7420, false)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)
  view.setUint32(36, 0x64617461, false)
  view.setUint32(40, dataSize, true)
  for (let i = 44; i < bufferSize; i++) view.setUint8(i, 0)
  return buffer
}

const mockAudio = {
  toBlob: () => new Blob([createMockWavBuffer(100)], { type: 'audio/wav' }),
}

const mockTTS = {
  generate: vi.fn().mockResolvedValue(mockAudio),
  stream: vi.fn().mockImplementation(async function* () {
    yield { text: 'Mock sentence', phonemes: 'mɑk sˈɛntəns', audio: mockAudio }
  }),
  list_voices: vi.fn(),
  voices: {},
}

class TextSplitterStream {
  push(_chunk: string) {
    // no-op
  }
  close() {
    // no-op
  }
}

vi.mock('kokoro-js', () => ({
  KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue(mockTTS) },
  TextSplitterStream,
}))

// Also aggressively mock 'phonemizer' if some transitive dependency tries to
// import it directly. This avoids loading heavy Emscripten code during tests.
try {
  vi.mock('phonemizer', () => ({
    // Provide an API surface that some code might use; keep it minimal.
    phonemize: async (_text: string) => _text.toUpperCase(),
  }))
} catch {
  // vi.mock will throw if already mocked; ignore
}

// Optional: silence noisy logs during tests
const originalLog = console.log.bind(console)
console.log = (...args: unknown[]) => {
  try {
    if (typeof args[0] === 'string' && String(args[0]).includes('Loading Kokoro TTS model')) return
  } catch {
    // ignore
  }
  originalLog(...args)
}

export {} // make this module a module
