import { writable } from 'svelte/store'
import logger from '../lib/utils/logger'

const STORAGE_KEY = 'audiobook_app_settings'

/**
 * Per-language TTS defaults.
 * Override priority: app settings < book settings < chapter settings
 */
export interface LanguageDefault {
  model?: string
  voice?: string
}

export interface AppSettings {
  /** Per-language model/voice defaults keyed by ISO 639-1 code */
  languageDefaults: Record<string, LanguageDefault>
}

const DEFAULT_SETTINGS: AppSettings = {
  languageDefaults: {},
}

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        languageDefaults: {
          ...DEFAULT_SETTINGS.languageDefaults,
          ...(parsed.languageDefaults ?? {}),
        },
      }
    }
  } catch (e) {
    logger.warn('Failed to load app settings:', e)
  }
  return DEFAULT_SETTINGS
}

function createAppSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(loadSettings())

  if (typeof window !== 'undefined') {
    subscribe((value) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (e) {
        logger.warn('Failed to save app settings:', e)
      }
    })
  }

  return {
    subscribe,
    set,
    update,

    /** Set model/voice defaults for a specific language */
    setLanguageDefault(langCode: string, defaults: LanguageDefault) {
      update((s) => ({
        ...s,
        languageDefaults: {
          ...s.languageDefaults,
          [langCode]: { ...s.languageDefaults[langCode], ...defaults },
        },
      }))
    },

    /** Remove language-specific defaults */
    removeLanguageDefault(langCode: string) {
      update((s) => {
        const { [langCode]: _, ...rest } = s.languageDefaults
        return { ...s, languageDefaults: rest }
      })
    },

    /** Get defaults for a language (returns undefined fields if not set) */
    getLanguageDefault(settings: AppSettings, langCode: string): LanguageDefault | undefined {
      return settings.languageDefaults[langCode]
    },

    /** Reset all settings to defaults */
    reset() {
      set(DEFAULT_SETTINGS)
    },
  }
}

export const appSettings = createAppSettingsStore()
