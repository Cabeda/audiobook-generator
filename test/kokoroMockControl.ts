/**
 * The audio the mocked kokoro-js hands back.
 *
 * The mock is registered for every test file, so a test that needs a different
 * audio asks for it through the KOKORO_MOCK_AUDIO environment variable rather
 * than by mocking the module again.
 */

/** A WAV blob of the given length, used as the mocked audio. */
export function createMockWavBuffer(durationMs: number = 100): ArrayBuffer {
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

/** The audio the mocked engine hands back. */
export interface MockAudio {
  toBlob: () => Promise<unknown> | unknown
}

/** A valid WAV, the audio the mock hands back by default. */
export function wavMockAudio(): MockAudio {
  return { toBlob: () => new Blob([createMockWavBuffer(100)], { type: 'audio/wav' }) }
}

/** The value a test runner hands back instead of a Blob. */
export function jsHandleMockAudio(): MockAudio {
  return {
    toBlob: () =>
      Promise.resolve({ toString: () => 'JSHandle@error', constructor: { name: 'JSHandle' } }),
  }
}

/** The audio the mock hands back, chosen by the environment. */
export function mockAudio(): MockAudio {
  return process.env.KOKORO_MOCK_AUDIO === 'jshandle' ? jsHandleMockAudio() : wavMockAudio()
}
