import { writable, type Writable } from 'svelte/store'
import logger from '../lib/utils/logger'
import { getOptimalTTSSettings } from '../lib/utils/mobileDetect'

// Storage keys
const VOICE_KEY = 'audiobook_voice'
const QUANT_KEY = 'audiobook_quantization'
const DEVICE_KEY = 'audiobook_device'
const MODEL_KEY = 'audiobook_model'

// Type definitions
export type Quantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
export type Device = 'auto' | 'wasm' | 'webgpu' | 'cpu'
import type { TTSModelType } from '../lib/tts/ttsModels'

export type TTSModel = TTSModelType

// Get adaptive defaults based on device capabilities
// Mobile devices get smaller/faster settings (q4 instead of q8)
function getAdaptiveDefaults(): { quantization: Quantization; device: Device } {
  if (typeof window === 'undefined') {
    // Server-side: use safe defaults
    return { quantization: 'q8', device: 'wasm' }
  }
  const optimal = getOptimalTTSSettings()
  return {
    quantization: optimal.quantization,
    device: optimal.device,
  }
}

// Helper to create a localStorage-synced writable store
// If no stored value exists, uses the provided default
function persistedWritable<T>(key: string, defaultValue: T): Writable<T> {
  let initialValue = defaultValue

  // Load from localStorage in browser
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        initialValue = JSON.parse(stored) as T
      }
    } catch (e) {
      logger.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  const store = writable<T>(initialValue)

  // Subscribe to changes and persist to localStorage
  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        logger.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

// Helper to create a localStorage-synced store with adaptive defaults
// Only uses adaptive default if no value is stored yet
function persistedWritableWithAdaptiveDefault<T>(key: string, getDefault: () => T): Writable<T> {
  // Check if user already has a stored preference
  let hasStoredValue = false
  let storedValue: T | undefined

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored !== null) {
        hasStoredValue = true
        storedValue = JSON.parse(stored) as T
      }
    } catch (e) {
      logger.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  // Use stored value if available, otherwise compute adaptive default
  const initialValue = hasStoredValue ? storedValue! : getDefault()

  const store = writable<T>(initialValue)

  // Subscribe to changes and persist to localStorage
  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        logger.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

// TTS configuration stores with localStorage persistence
export const selectedVoice = persistedWritable<string>(VOICE_KEY, 'af_heart')
// Use adaptive quantization: q4 on mobile, q8 on desktop (if no stored preference)
export const selectedQuantization = persistedWritableWithAdaptiveDefault<Quantization>(
  QUANT_KEY,
  () => getAdaptiveDefaults().quantization
)
// Use adaptive device selection based on hardware capabilities
export const selectedDevice = persistedWritableWithAdaptiveDefault<Device>(
  DEVICE_KEY,
  () => getAdaptiveDefaults().device
)
export const selectedModel = persistedWritable<TTSModel>(MODEL_KEY, 'kokoro')

// Model-specific voice persistence
export const lastKokoroVoice = persistedWritable<string>('audiobook_voice_kokoro', 'af_heart')
export const lastPiperVoice = persistedWritable<string>(
  'audiobook_voice_piper',
  'en_US-hfc_female-medium'
)

import { ADVANCED_SETTINGS_SCHEMA } from '../lib/types/settings'

// Initialize default advanced settings
const defaultAdvancedSettings: Record<string, any> = {}
for (const [modelId, settings] of Object.entries(ADVANCED_SETTINGS_SCHEMA)) {
  defaultAdvancedSettings[modelId] = {}
  for (const setting of settings) {
    defaultAdvancedSettings[modelId][setting.key] = setting.defaultValue
  }
}

function mergeAdvancedSettings(
  stored: Record<string, any> | null,
  defaults: Record<string, any>
): Record<string, any> {
  const merged = JSON.parse(JSON.stringify(defaults)) as Record<string, any>
  if (!stored) return merged

  for (const [modelId, settings] of Object.entries(stored)) {
    if (!merged[modelId]) merged[modelId] = {}
    for (const [key, value] of Object.entries(settings || {})) {
      merged[modelId][key] = value ?? merged[modelId][key]
    }
  }
  return merged
}

function persistedAdvancedSettings(key: string): Writable<Record<string, any>> {
  let initialValue = defaultAdvancedSettings

  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        initialValue = mergeAdvancedSettings(
          JSON.parse(stored) as Record<string, any>,
          defaultAdvancedSettings
        )
      }
    } catch (e) {
      logger.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  const store = writable<Record<string, any>>(initialValue)

  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        logger.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

export const advancedSettings = persistedAdvancedSettings('audiobook_advanced_settings')

export interface VoiceOption {
  id: string
  label: string
}

export const availableVoices = writable<VoiceOption[]>([])

export { voiceLabels } from '../lib/kokoro/kokoroVoices'
