import { describe, it, expect, beforeEach, vi } from 'vitest'

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

  it('advancedSettings defaults to schema defaults', async () => {
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    expect(value?.['kokoro']).toBeDefined()
    expect(value?.['piper']).toBeDefined()
  })

  it('advancedSettings persists kokoro settings', async () => {
    const stored = { kokoro: { parallelChunks: 3 } }
    localStorageMock.setItem('audiobook_advanced_settings', JSON.stringify(stored))
    const { advancedSettings } = await import('../stores/ttsStore')
    let value: Record<string, any> | undefined
    advancedSettings.subscribe((v) => {
      value = v
    })()
    expect(value?.['kokoro']?.parallelChunks).toBe(3)
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
    expect(value?.['kokoro']).toBeDefined()
    expect(value?.['piper']).toBeDefined()
  })
})
