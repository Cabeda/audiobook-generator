import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  engineCapabilities,
  engineSupportsLanguage,
  engineVoices,
  getTTSEngine,
  type TTSRequest,
} from './ttsModels'

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

  it('declares what each engine can do, so no caller compares names', () => {
    expect(engineSupportsLanguage('kokoro', 'en-GB')).toBe(true)
    expect(engineSupportsLanguage('kokoro', 'de')).toBe(false)
    expect(engineSupportsLanguage('pocket', 'en')).toBe(true)
    expect(engineSupportsLanguage('pocket', 'de')).toBe(false)
    expect(engineSupportsLanguage('piper', 'de')).toBe(true)

    expect(engineCapabilities('kokoro').qualityLadder).toBe('quantization')
    expect(engineCapabilities('piper').qualityLadder).toBe('voices')
    expect(engineCapabilities('pocket').qualityLadder).toBe('single')

    expect(engineVoices('pocket')).toContain('alba')
    expect(engineVoices('piper')).toBeUndefined()
  })

  it('gives the engine its own name and capabilities', async () => {
    const engine = await getTTSEngine('pocket')

    expect(engine.id).toBe('pocket')
    expect(engine.capabilities.qualityLadder).toBe('single')
  })

  it('rejects an unknown engine', async () => {
    await expect(getTTSEngine('nope' as 'kokoro')).rejects.toThrow('Unknown TTS model type')
  })
})
