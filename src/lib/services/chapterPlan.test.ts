import { describe, it, expect } from 'vitest'
import { planChapter } from './chapterPlan'

const base = {
  chapter: {} as { model?: string; voice?: string },
  language: 'en',
  languageDefaults: {} as Record<string, { model?: string; voice?: string } | undefined>,
  selectedModel: 'kokoro',
  selectedVoice: 'af_heart',
  selectedQuantization: 'q8' as const,
  selectedDevice: 'auto' as const,
}

describe('planChapter', () => {
  it('uses the global selection when the chapter has no override', () => {
    const plan = planChapter(base)

    expect(plan.model).toBe('kokoro')
    expect(plan.voice).toBe('af_heart')
    expect(plan.quantization).toBe('q8')
    expect(plan.device).toBe('auto')
    expect(plan.isFallbackModel).toBe(false)
  })

  it('prefers the chapter override over everything else', () => {
    const plan = planChapter({
      ...base,
      chapter: { model: 'piper', voice: 'en_US-high' },
    })

    expect(plan.model).toBe('piper')
    expect(plan.voice).toBe('en_US-high')
  })

  it('prefers the app default for the language over the global selection', () => {
    const plan = planChapter({
      ...base,
      language: 'de',
      languageDefaults: { de: { model: 'piper', voice: 'de_DE-high' } },
    })

    expect(plan.model).toBe('piper')
    expect(plan.voice).toBe('de_DE-high')
  })

  it('falls back to Piper when the engine does not cover the language', () => {
    const plan = planChapter({ ...base, language: 'ja' })

    expect(plan.model).toBe('piper')
    expect(plan.isFallbackModel).toBe(true)
  })

  it('falls back to Piper when Pocket TTS does not cover the language', () => {
    const plan = planChapter({ ...base, language: 'de', selectedModel: 'pocket' })

    expect(plan.model).toBe('piper')
    expect(plan.isFallbackModel).toBe(true)
  })

  it('keeps Pocket TTS for English', () => {
    const plan = planChapter({ ...base, selectedModel: 'pocket' })

    expect(plan.model).toBe('pocket')
    expect(plan.isFallbackModel).toBe(false)
  })

  it('falls back to Piper when KittenTTS does not cover the language', () => {
    const plan = planChapter({ ...base, language: 'de', selectedModel: 'kitten' })

    expect(plan.model).toBe('piper')
    expect(plan.isFallbackModel).toBe(true)
  })

  it('keeps KittenTTS for English and gives it one of its own voices', () => {
    const plan = planChapter({ ...base, selectedModel: 'kitten', selectedVoice: 'af_heart' })

    expect(plan.model).toBe('kitten')
    expect(plan.voice).toBe('Bella')
  })

  it('picks a Piper voice the fallback engine can use', () => {
    const plan = planChapter({
      ...base,
      language: 'ja',
      piperVoices: [
        { key: 'ja_JP-medium', name: 'Japanese', language: 'ja_JP', quality: 'medium' },
        { key: 'en_US-high', name: 'English', language: 'en_US', quality: 'high' },
      ],
    })

    expect(plan.model).toBe('piper')
    expect(plan.voice).toBe('ja_JP-medium')
  })

  it('caps the weight precision on constrained devices', () => {
    const plan = planChapter({ ...base, isMobile: true })

    expect(plan.quantization).toBe('q4')
  })
})
