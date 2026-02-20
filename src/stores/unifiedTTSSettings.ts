/**
 * Unified TTS Settings Store with Hierarchical Overrides
 *
 * Architecture:
 * - Global settings: Default for all books/chapters
 * - Chapter settings: Override global, stored per chapter
 * - Text reader settings: Override chapter, temporary for session
 *
 * State Machine:
 * - Validates model/voice combinations
 * - Prevents invalid states (e.g., piper/bella)
 * - Ensures quantization/device compatibility
 */

import { writable, get } from 'svelte/store'
import type { TTSModelType } from '../lib/tts/ttsModels'
import logger from '../lib/utils/logger'

// ============================================================================
// Types
// ============================================================================

export type Quantization = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
export type Device = 'auto' | 'wasm' | 'webgpu' | 'cpu'

export interface TTSSettings {
  model: TTSModelType | 'web_speech'
  voice: string
  quantization?: Quantization
  device?: Device
  speed?: number
}

export interface SettingsLevel {
  global: TTSSettings
  chapter: Map<string, Partial<TTSSettings>> // chapterId -> overrides
  textReader: Partial<TTSSettings> | null // temporary session overrides
}

// ============================================================================
// Voice Validation
// ============================================================================

const KOKORO_VOICES = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_emma',
  'bf_isabella',
  'bf_alice',
  'bf_lily',
  'bm_george',
  'bm_lewis',
  'bm_daniel',
  'bm_fable',
]

// Piper voices are dynamic - loaded from API
let piperVoices: string[] = []

export function setPiperVoices(voices: string[]) {
  piperVoices = voices
}

/**
 * Validates if a voice is valid for a given model
 */
export function isValidVoiceForModel(model: TTSModelType | 'web_speech', voice: string): boolean {
  switch (model) {
    case 'kokoro':
      return KOKORO_VOICES.includes(voice)
    case 'piper':
      return piperVoices.length === 0 || piperVoices.includes(voice)
    case 'web_speech':
      return true // Web Speech voices are browser-dependent
    default:
      return false
  }
}

/**
 * Gets default voice for a model
 */
export function getDefaultVoiceForModel(model: TTSModelType | 'web_speech'): string {
  switch (model) {
    case 'kokoro':
      return 'af_heart'
    case 'piper':
      return piperVoices[0] || 'en_US-hfc_female-medium'
    case 'web_speech':
      return '' // Browser default
    default:
      return 'af_heart'
  }
}

/**
 * Validates and fixes settings to ensure valid state
 */
export function validateSettings(settings: TTSSettings): TTSSettings {
  const validated = { ...settings }

  // Validate voice for model
  if (!isValidVoiceForModel(validated.model, validated.voice)) {
    logger.warn(`Invalid voice "${validated.voice}" for model "${validated.model}", using default`)
    validated.voice = getDefaultVoiceForModel(validated.model)
  }

  // Quantization only applies to kokoro
  if (validated.model !== 'kokoro') {
    delete validated.quantization
  }

  // Device only applies to kokoro and piper
  if (validated.model === 'web_speech') {
    delete validated.device
  }

  return validated
}

// ============================================================================
// Store Implementation
// ============================================================================

const STORAGE_KEY = 'audiobook_tts_settings_v2'

function loadSettings(): SettingsLevel {
  const defaultSettings: SettingsLevel = {
    global: {
      model: 'kokoro',
      voice: 'af_heart',
      quantization: 'q8',
      device: 'auto',
      speed: 1.0,
    },
    chapter: new Map(),
    textReader: null,
  }

  if (typeof window === 'undefined') return defaultSettings

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        global: validateSettings(parsed.global || defaultSettings.global),
        chapter: new Map(Object.entries(parsed.chapter || {})),
        textReader: parsed.textReader || null,
      }
    }
  } catch (e) {
    logger.error('Failed to load TTS settings:', e)
  }

  return defaultSettings
}

function saveSettings(settings: SettingsLevel) {
  if (typeof window === 'undefined') return

  try {
    const toSave = {
      global: settings.global,
      chapter: Object.fromEntries(settings.chapter),
      textReader: settings.textReader,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch (e) {
    logger.error('Failed to save TTS settings:', e)
  }
}

// Create the store
const settingsStore = writable<SettingsLevel>(loadSettings())

// Auto-save on changes
settingsStore.subscribe(saveSettings)

// ============================================================================
// Public API
// ============================================================================

/**
 * Get effective settings for a chapter (with hierarchy applied)
 */
export function getEffectiveSettings(chapterId?: string): TTSSettings {
  const state = get(settingsStore)

  // Start with global
  let effective = { ...state.global }

  // Apply chapter overrides
  if (chapterId && state.chapter.has(chapterId)) {
    effective = { ...effective, ...state.chapter.get(chapterId) }
  }

  // Apply text reader overrides
  if (state.textReader) {
    effective = { ...effective, ...state.textReader }
  }

  // Validate final settings
  return validateSettings(effective)
}

/**
 * Update global settings
 */
export function setGlobalSettings(settings: Partial<TTSSettings>) {
  settingsStore.update((state) => {
    state.global = validateSettings({ ...state.global, ...settings })
    return state
  })
}

/**
 * Update chapter-specific settings
 */
export function setChapterSettings(chapterId: string, settings: Partial<TTSSettings>) {
  settingsStore.update((state) => {
    const current = state.chapter.get(chapterId) || {}
    state.chapter.set(chapterId, { ...current, ...settings })
    return state
  })
}

/**
 * Update text reader temporary settings
 */
export function setTextReaderSettings(settings: Partial<TTSSettings> | null) {
  settingsStore.update((state) => {
    state.textReader = settings
    return state
  })
}

/**
 * Clear text reader overrides
 */
export function clearTextReaderSettings() {
  setTextReaderSettings(null)
}

/**
 * Clear chapter overrides
 */
export function clearChapterSettings(chapterId: string) {
  settingsStore.update((state) => {
    state.chapter.delete(chapterId)
    return state
  })
}

// Export store for reactive subscriptions
export const ttsSettings = {
  subscribe: settingsStore.subscribe,
  getEffective: getEffectiveSettings,
  setGlobal: setGlobalSettings,
  setChapter: setChapterSettings,
  setTextReader: setTextReaderSettings,
  clearTextReader: clearTextReaderSettings,
  clearChapter: clearChapterSettings,
}
