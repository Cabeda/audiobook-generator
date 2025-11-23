import { writable, type Writable } from 'svelte/store'

// Storage keys
const VOICE_KEY = 'audiobook_voice'
const QUANT_KEY = 'audiobook_quantization'
const DEVICE_KEY = 'audiobook_device'
const MODEL_KEY = 'audiobook_model'

// Type definitions
export type Quantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
export type Device = 'auto' | 'wasm' | 'webgpu' | 'cpu'
export type TTSModel = 'kokoro' | 'piper'

// Helper to create a localStorage-synced writable store
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
      console.warn(`Failed to load ${key} from localStorage:`, e)
    }
  }

  const store = writable<T>(initialValue)

  // Subscribe to changes and persist to localStorage
  if (typeof window !== 'undefined') {
    store.subscribe((value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        console.warn(`Failed to save ${key} to localStorage:`, e)
      }
    })
  }

  return store
}

// TTS configuration stores with localStorage persistence
export const selectedVoice = persistedWritable<string>(VOICE_KEY, 'af_heart')
export const selectedQuantization = persistedWritable<Quantization>(QUANT_KEY, 'q8')
export const selectedDevice = persistedWritable<Device>(DEVICE_KEY, 'auto')
export const selectedModel = persistedWritable<TTSModel>(MODEL_KEY, 'kokoro')
