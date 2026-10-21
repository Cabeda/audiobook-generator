import { vi } from 'vitest'
import { mockAudio } from './kokoroMockControl'

// Polyfill Blob.arrayBuffer() for jsdom environment
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = async function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// Global tests setup to prevent loading heavy WASM modules (e.g., phonemizer via kokoro-js)
// across parallel test workers. We provide a minimal, deterministic mock of `kokoro-js`
// that is used by many tests (kokoroClient, integration tests) and removes the
// chance of the Emscripten/phonemizer code being loaded and spawning worker pools.

// The audio the mock hands back. A test chooses it with KOKORO_MOCK_AUDIO.
const mockTTS = {
  generate: vi.fn().mockImplementation(async () => mockAudio()),
  stream: vi.fn().mockImplementation(async function* () {
    yield { text: 'Mock sentence', phonemes: 'mɑk sˈɛntəns', audio: mockAudio() }
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
// It has to be at the top level: vitest hoists the call and complains when it
// is nested.
vi.mock('phonemizer', () => ({
  // Provide an API surface that some code might use; keep it minimal.
  phonemize: async (_text: string) => _text.toUpperCase(),
}))

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
