import { vi } from 'vitest'

/** Creates a minimal valid WAV blob (44-byte header + 10ms silence) */
function createValidWavBlob(): Blob {
  const sampleRate = 24000
  const numChannels = 1
  const bitsPerSample = 16
  const numSamples = 240 // 10ms of silence
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const bufferSize = 44 + dataSize
  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, bufferSize - 8, true)
  view.setUint32(8, 0x57415645, false) // "WAVE"
  view.setUint32(12, 0x666d7420, false) // "fmt "
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, dataSize, true)
  return new Blob([buffer], { type: 'audio/wav' })
}

export function createDefaultKokoroMock() {
  const createMockAudio = (_data: string) => ({
    toBlob: () => createValidWavBlob(),
  })

  const mockTTS = {
    generate: vi
      .fn()
      .mockImplementation(async (text: string) => createMockAudio(`mock audio for: ${text}`)),
    stream: vi.fn().mockImplementation((splitter: any) => {
      return (async function* () {
        const chunks: string[] = []
        let closed = false

        const originalPush = splitter.push?.bind(splitter) || (() => {})
        const originalClose = splitter.close?.bind(splitter) || (() => {})

        splitter.push = (text: string) => {
          chunks.push(text)
          originalPush(text)
        }

        splitter.close = () => {
          closed = true
          originalClose()
        }

        while (!closed || chunks.length > 0) {
          if (chunks.length > 0) {
            const text = chunks.shift()!
            yield {
              text,
              phonemes: 'mock phonemes',
              audio: createMockAudio(text),
            }
          } else {
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
        }
      })()
    }),
    list_voices: vi.fn(),
    voices: {},
  }

  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue(mockTTS),
    },
    TextSplitterStream: vi.fn().mockImplementation(function (this: any) {
      this.chunks = []
      this.closed = false
      this.push = (text: string) => {
        this.chunks.push(text)
      }
      this.close = () => {
        this.closed = true
      }
    }),
  }
}

export function createJSHandleKokoroMock() {
  const createMockAudioBad = () => ({
    toBlob: () =>
      Promise.resolve({ toString: () => 'JSHandle@error', constructor: { name: 'JSHandle' } }),
  })

  const mockTTSBad = {
    generate: vi.fn().mockImplementation(async (_text: string) => createMockAudioBad()),
    stream: vi.fn().mockImplementation((_splitter: any) => {
      return (async function* () {
        yield { text: 'chunk', phonemes: 'p', audio: createMockAudioBad() }
      })()
    }),
    list_voices: vi.fn(),
    voices: {},
  }

  return {
    KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue(mockTTSBad) },
    TextSplitterStream: vi.fn().mockImplementation(function (this: any) {
      this.chunks = []
      this.closed = false
      this.push = (text: string) => {
        this.chunks.push(text)
      }
      this.close = () => {
        this.closed = true
      }
    }),
  }
}
