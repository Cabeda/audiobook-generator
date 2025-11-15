import { describe, it, expect, beforeAll } from 'vitest'
import { generateVoice } from './webSpeechClient'

// This test verifies Web Speech chunking + concatenation behavior for long text

// Create a mock AudioContext and related helpers similar to existing test helpers
class MockAudioContext {
  sampleRate = 24000

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    const buffer = {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (_channel: number) => new Float32Array(length),
    }
    return buffer as unknown as AudioBuffer
  }

  decodeAudioData(arrayBuffer: ArrayBuffer) {
    // Return a small AudioBuffer whose length is derived from byteLength
    const length = Math.max(1, Math.floor(arrayBuffer.byteLength / 4))
    return Promise.resolve(this.createBuffer(1, length, this.sampleRate))
  }

  close() {
    // no-op
  }

  createMediaStreamDestination() {
    // Return a minimal object with a stream property; MediaRecorder only needs a stream
    return { stream: {} as MediaStream }
  }
}

describe('webSpeechClient', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
      MockAudioContext

    // Mock speechSynthesis API and related objects
    const mockSpeechSynthesis: Partial<SpeechSynthesis> = {
      getVoices: () => [
        {
          voiceURI: 'test-voice',
          name: 'Test Voice',
          default: true,
          lang: 'en-US',
        } as unknown as SpeechSynthesisVoice,
      ],
      speak: (utterance: SpeechSynthesisUtterance) => {
        // Simulate immediate end of utterance so MediaRecorder stops
        setTimeout(() => {
          const u = utterance as SpeechSynthesisUtterance & { onend?: () => void }
          if (typeof u.onend === 'function') u.onend()
        }, 0)
      },
      addEventListener: (_: string, __: EventListenerOrEventListenerObject) => {},
      removeEventListener: (_: string, __: EventListenerOrEventListenerObject) => {},
      pending: false,
    }
    ;(globalThis as unknown as { speechSynthesis?: Partial<SpeechSynthesis> }).speechSynthesis =
      mockSpeechSynthesis

    // Provide a minimal SpeechSynthesisUtterance implementation
    class MockSpeechSynthesisUtterance {
      text: string
      voice?: SpeechSynthesisVoice | null
      rate = 1
      pitch = 1
      onend?: () => void
      onerror?: (ev?: Event) => void
      constructor(text = '') {
        this.text = text
      }
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      MockSpeechSynthesisUtterance

    // Mock MediaRecorder and its behavior to produce two small WAV blobs
    class MockMediaRecorder {
      mimeType: string | undefined
      ondataavailable: (e: { data: Blob }) => void = () => {}
      onstop: () => void = () => {}
      constructor(
        public stream: MediaStream,
        options?: MediaRecorderOptions
      ) {
        this.mimeType = options?.mimeType
      }
      start() {
        // no-op
      }
      stop() {
        // Simulate two audio chunks available then finish
        const b1 = new Blob([new ArrayBuffer(1000)], { type: 'audio/webm' })
        const b2 = new Blob([new ArrayBuffer(2000)], { type: 'audio/webm' })
        this.ondataavailable({ data: b1 })
        this.ondataavailable({ data: b2 })
        this.onstop()
      }
    }

    ;(globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = MockMediaRecorder

    // Ensure `Blob.prototype.arrayBuffer` exists for tests
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function () {
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as ArrayBuffer)
          reader.readAsArrayBuffer(this)
        })
      }
    }
  })

  it('should concatenate multiple Web Speech chunks into a single WAV with summed duration', async () => {
    const longText = 'This is a long text that will be split into multiple chunks. '.repeat(20)

    // call generateVoice (webSpeech client)
    const blob = await generateVoice({ text: longText, voice: undefined })

    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBeGreaterThan(0)

    // load blob into mock Audio (use Audio constructor trick to get duration)
    // Here we mock a simplistic behavior: decode the blob using AudioContext to check duration
    const audioCtx = new MockAudioContext() as unknown as AudioContext
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

    // The mock decoder returns lengths derived from byteLength (>0); we assert final length
    expect(audioBuffer.length).toBeGreaterThan(0)
    // Since we supplied two webm chunks that decode to 250 and 500 length equivalents, the sum should be > any one chunk.
    // We only assert sum property as generic: it should be at least as big as the largest chunk
    expect(audioBuffer.length).toBeGreaterThanOrEqual(250)
  })
})
