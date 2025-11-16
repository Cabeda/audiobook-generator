import { describe, it, expect, beforeAll } from 'vitest'
import { generateVoice } from './edgeTtsClient'

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
    const length = Math.max(1, Math.floor(arrayBuffer.byteLength / 4))
    return Promise.resolve(this.createBuffer(1, length, this.sampleRate))
  }

  close() {
    // no-op
  }
}

describe('edgeTtsClient', () => {
  beforeAll(() => {
    ;(globalThis as unknown as { AudioContext: typeof MockAudioContext }).AudioContext =
      MockAudioContext
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

  it('should concatenate chunks and produce WAV', async () => {
    const longText = 'This is a long text. '.repeat(20)
    const blob = await generateVoice({ text: longText })
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/wav')
    const ctx = new MockAudioContext() as unknown as AudioContext
    const array = await blob.arrayBuffer()
    const decoded = await ctx.decodeAudioData(array)
    expect(decoded.length).toBeGreaterThan(0)
  })
})
