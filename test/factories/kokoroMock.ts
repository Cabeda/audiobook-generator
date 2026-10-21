import { vi } from 'vitest'
import { jsHandleMockAudio, mockAudio } from '../kokoroMockControl'

export function createDefaultKokoroMock() {
  // The audio comes from the shared control, so a test can ask for a
  // JSHandle instead of a Blob through KOKORO_MOCK_AUDIO.
  const createMockAudio = (_data: string) => mockAudio()

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
  const createMockAudioBad = () => jsHandleMockAudio()

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
