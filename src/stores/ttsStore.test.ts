import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ADVANCED_SETTINGS_SCHEMA } from '../lib/types/settings'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })

describe('TTS settings persistence', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.resetModules()
  })

  it('selectedModel defaults to kokoro', async () => {
    const { selectedModel } = await import('../stores/ttsStore')
    let value: string | undefined
    selectedModel.subscribe((v) => {
      value = v
    })()
    expect(value).toBe('kokoro')
  })

  it('selectedModel persists kitten across module reload', async () => {
    localStorageMock.setItem('audiobook_model', JSON.stringify('kitten'))
    const { selectedModel } = await import('../stores/ttsStore')
    let value: string | undefined
    selectedModel.subscribe((v) => {
      value = v
    })()
    expect(value).toBe('kitten')
  })

  it('lastKittenVoice defaults to Bella', async () => {
    const { lastKittenVoice } = await import('../stores/ttsStore')
    let value: string | undefined
    lastKittenVoice.subscribe((v) => {
      value = v
    })()
    expect(value).toBe('Bella')
  })

  it('lastKittenVoice persists custom voice', async () => {
    localStorageMock.setItem('audiobook_voice_kitten', JSON.stringify('Luna'))
    const { lastKittenVoice } = await import('../stores/ttsStore')
    let value: string | undefined
    lastKittenVoice.subscribe((v) => {
      value = v
    })()
    expect(value).toBe('Luna')
  })

  it('advancedSettings defaults kitten.modelVariant to micro', async () => {
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    expect(value?.['kitten']?.modelVariant).toBe('micro')
  })

  it('advancedSettings persists kitten.modelVariant nano', async () => {
    const stored = { kitten: { modelVariant: 'nano', speed: 1.2 } }
    localStorageMock.setItem('audiobook_advanced_settings', JSON.stringify(stored))
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    expect(value?.['kitten']?.modelVariant).toBe('nano')
    expect(value?.['kitten']?.speed).toBe(1.2)
  })

  it('advancedSettings merges stored with defaults (missing keys get defaults)', async () => {
    // Only store modelVariant, speed should get default
    localStorageMock.setItem(
      'audiobook_advanced_settings',
      JSON.stringify({ kitten: { modelVariant: 'mini' } })
    )
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    expect(value?.['kitten']?.modelVariant).toBe('mini')
    expect(value?.['kitten']?.speed).toBe(1.0) // default
  })

  it('all kitten advanced setting keys match schema', async () => {
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    const schemaKeys = ADVANCED_SETTINGS_SCHEMA['kitten'].map((s) => s.key)
    const storeKeys = Object.keys(value?.['kitten'] ?? {})
    for (const key of schemaKeys) {
      expect(storeKeys).toContain(key)
    }
  })
})
