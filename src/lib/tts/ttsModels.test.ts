import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MODEL_OPTIONS,
  engineCapabilities,
  engineSupportsLanguage,
  engineVoices,
  getTTSEngine,
  voiceOptionsFor,
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

    expect(engineSupportsLanguage('kitten', 'en-US')).toBe(true)
    expect(engineSupportsLanguage('kitten', 'fr')).toBe(false)
    expect(engineCapabilities('kitten').qualityLadder).toBe('single')
    expect(engineVoices('kitten')).toEqual([
      'Bella',
      'Jasper',
      'Luna',
      'Bruno',
      'Rosie',
      'Hugo',
      'Kiki',
      'Leo',
    ])
  })

  it('gives the engine its own name and capabilities', async () => {
    const engine = await getTTSEngine('pocket')

    expect(engine.id).toBe('pocket')
    expect(engine.capabilities.qualityLadder).toBe('single')
  })

  it('gives KittenTTS its own name and voice catalogue', async () => {
    const engine = await getTTSEngine('kitten')

    expect(engine.id).toBe('kitten')
    expect(engine.capabilities).toEqual({ languages: ['en'], qualityLadder: 'single' })
  })

  it('rejects an unknown engine', async () => {
    await expect(getTTSEngine('nope' as 'kokoro')).rejects.toThrow('Unknown TTS model type')
  })
})

describe('the picker lists', () => {
  it('offer every registered engine plus the browser one, in one place', () => {
    expect(MODEL_OPTIONS.map((model) => model.id)).toEqual([
      'web_speech',
      'kokoro',
      'piper',
      'pocket',
      'kitten',
    ])
    expect(MODEL_OPTIONS.every((model) => model.name.length > 0)).toBe(true)
  })

  it('name KittenTTS the way the rest of the app does', () => {
    expect(MODEL_OPTIONS.find((model) => model.id === 'kitten')?.name).toBe('KittenTTS')
  })
})

describe('voiceOptionsFor', () => {
  it('lists the catalogue of an engine from the registry, with no engine branch', () => {
    expect(voiceOptionsFor('kitten', 'en')).toEqual([
      { id: 'Bella', label: 'Bella' },
      { id: 'Jasper', label: 'Jasper' },
      { id: 'Luna', label: 'Luna' },
      { id: 'Bruno', label: 'Bruno' },
      { id: 'Rosie', label: 'Rosie' },
      { id: 'Hugo', label: 'Hugo' },
      { id: 'Kiki', label: 'Kiki' },
      { id: 'Leo', label: 'Leo' },
    ])
  })

  it('uses the labels the engine ships when it has them', () => {
    const pocket = voiceOptionsFor('pocket', 'en')

    expect(pocket[0].id).toBe('alba')
    expect(pocket[0].label).not.toBe('alba')
    expect(voiceOptionsFor('kokoro', 'en').length).toBeGreaterThan(0)
  })

  it('offers nothing for a language the engine does not cover', () => {
    expect(voiceOptionsFor('kitten', 'de')).toEqual([])
    expect(voiceOptionsFor('pocket', 'de')).toEqual([])
  })

  it('leaves the Web Speech voices to the browser', () => {
    expect(voiceOptionsFor('web_speech', 'en')).toEqual([])
  })

  it('takes the Piper catalogue from the voices that are loaded, filtered by language', () => {
    const piperVoices = [
      { key: 'de_DE-thorsten', name: 'Thorsten', language: 'de_DE', quality: 'medium' },
      { key: 'en_US-amy', name: 'Amy', language: 'en_US', quality: 'high' },
    ]

    expect(voiceOptionsFor('piper', 'de', piperVoices as never)).toEqual([
      { id: 'de_DE-thorsten', label: 'Thorsten' },
    ])
    expect(voiceOptionsFor('piper', 'de')).toEqual([])
  })
})
