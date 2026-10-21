import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTTSEngine, type TTSRequest } from './ttsModels'

vi.mock('../kokoro/kokoroClient', () => ({
  generateVoice: vi.fn(async () => new Blob(['kokoro'], { type: 'audio/wav' })),
  generateVoiceSegments: vi.fn(async () => []),
}))

vi.mock('../piper/piperClient', () => ({
  generateVoice: vi.fn(async () => new Blob(['piper'], { type: 'audio/wav' })),
}))

const kokoroClient = await import('../kokoro/kokoroClient')
const piperClient = await import('../piper/piperClient')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TTS engine seam', () => {
  it('gives the engine a request that carries no engine-specific knobs', () => {
    const request: TTSRequest = { text: 'Hello.', voice: 'af_heart' }
    expect('dtype' in request).toBe(false)
    expect('model' in request).toBe(false)
    expect('device' in request).toBe(false)
  })

  it('lets the Kokoro adapter read its own config', async () => {
    const engine = await getTTSEngine('kokoro', { dtype: 'q4', device: 'wasm' })

    await engine.generateVoice({ text: 'Hello.', voice: 'af_heart' })

    expect(kokoroClient.generateVoice).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello.', voice: 'af_heart', dtype: 'q4', device: 'wasm' }),
      undefined,
      undefined
    )
  })

  it('keeps Kokoro knobs away from the Piper adapter', async () => {
    const engine = await getTTSEngine('piper', { dtype: 'q4', device: 'wasm' })

    await engine.generateVoice({ text: 'Hello.', voice: 'en_US-low', speed: 1 })

    expect(piperClient.generateVoice).toHaveBeenCalledWith(
      { text: 'Hello.', voice: 'en_US-low', speed: 1 },
      undefined,
      undefined
    )
  })

  it('rejects an unknown engine', async () => {
    await expect(getTTSEngine('nope' as 'kokoro')).rejects.toThrow('Unknown TTS model type')
  })
})
