import type { VoiceId } from '../kokoro/kokoroClient'
import type { PiperVoice } from '../piper/piperClient'

/**
 * Language to Kokoro voice mapping
 * Kokoro voices use prefixes:
 * a=American, b=British, j=Japanese, z=Chinese, e=Spanish, f=French, h=Hindi, i=Italian, p=Portuguese-BR
 * f/m after lang code = female/male
 */
const KOKORO_LANGUAGE_MAP: Record<string, VoiceId[]> = {
  en: [
    // American English voices (default for 'en')
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
    // British English voices
    'bf_emma',
    'bf_isabella',
    'bf_alice',
    'bf_lily',
    'bm_george',
    'bm_lewis',
    'bm_daniel',
    'bm_fable',
  ],
  'en-us': [
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
  ],
  'en-gb': [
    'bf_emma',
    'bf_isabella',
    'bf_alice',
    'bf_lily',
    'bm_george',
    'bm_lewis',
    'bm_daniel',
    'bm_fable',
  ],
  // Japanese
  ja: ['jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo', 'jm_beta'],
  // Chinese (Mandarin)
  zh: [
    'zf_xiaobei',
    'zf_xiaoni',
    'zf_xiaoxiao',
    'zf_xiaoyi',
    'zm_yunjian',
    'zm_yunxi',
    'zm_yunxia',
    'zm_yunyang',
  ],
  'zh-cn': [
    'zf_xiaobei',
    'zf_xiaoni',
    'zf_xiaoxiao',
    'zf_xiaoyi',
    'zm_yunjian',
    'zm_yunxi',
    'zm_yunxia',
    'zm_yunyang',
  ],
  // Spanish
  es: ['ef_dora', 'em_alex', 'em_santa'],
  // French
  fr: ['ff_siwis'],
  // Hindi
  hi: ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi'],
  // Italian
  it: ['if_sara', 'im_nicola'],
  // Brazilian Portuguese
  pt: ['pf_dora', 'pm_alex', 'pm_santa'],
  'pt-br': ['pf_dora', 'pm_alex', 'pm_santa'],
}

/**
 * Check if the Kokoro model supports a given language
 */
export function isKokoroLanguageSupported(language: string): boolean {
  const normalizedLang = language.toLowerCase().trim()
  if (KOKORO_LANGUAGE_MAP[normalizedLang]) return true
  const baseLang = normalizedLang.split(/[-_]/)[0]
  return !!KOKORO_LANGUAGE_MAP[baseLang]
}

/**
 * Select an appropriate Kokoro voice based on language
 * @param language ISO 639-1 language code or language-region code (e.g., 'en', 'en-US', 'en-GB')
 * @param preferredVoice Optional preferred voice ID to use if compatible
 * @returns VoiceId that matches the language, or default voice
 */
export function selectKokoroVoiceForLanguage(language: string, preferredVoice?: string): VoiceId {
  // Normalize language code
  const normalizedLang = language.toLowerCase().trim()

  // Determine the voices for this language
  let voicesForLang: VoiceId[]
  if (KOKORO_LANGUAGE_MAP[normalizedLang]) {
    voicesForLang = KOKORO_LANGUAGE_MAP[normalizedLang]
  } else {
    const baseLang = normalizedLang.split(/[-_]/)[0]
    voicesForLang = KOKORO_LANGUAGE_MAP[baseLang] || KOKORO_LANGUAGE_MAP['en']
  }

  // Check if preferred voice is compatible with the language
  if (preferredVoice && voicesForLang.includes(preferredVoice as VoiceId)) {
    return preferredVoice as VoiceId
  }

  // Return first voice for the language
  return voicesForLang[0]
}

/**
 * Language code to ISO 639-1 mapping for common languages
 * Maps full language names and common codes to standard ISO codes
 */
const LANGUAGE_CODE_MAP: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  polish: 'pl',
  russian: 'ru',
  japanese: 'ja',
  chinese: 'zh',
  korean: 'ko',
  arabic: 'ar',
  hindi: 'hi',
}

/**
 * Normalize language code to ISO 639-1 format
 */
function normalizeLanguageCode(language: string): string {
  const lower = language.toLowerCase().trim()

  // Already a standard code (2 letters)
  if (/^[a-z]{2}$/.test(lower)) {
    return lower
  }

  // Check if it's a language-region code like 'en-US' or 'en_US'
  if (lower.includes('-') || lower.includes('_')) {
    const parts = lower.split(/[-_]/)
    return parts[0]
  }

  // Try to extract from patterns like "English (US)" or "Spanish (Spain)"
  const match = lower.match(/^([a-z]+)(?:\s|$|\()/)
  if (match) {
    const langName = match[1]
    if (LANGUAGE_CODE_MAP[langName]) {
      return LANGUAGE_CODE_MAP[langName]
    }
  }

  // Try to map from full language name
  return LANGUAGE_CODE_MAP[lower] || 'en'
}

/**
 * Select an appropriate Piper voice based on language
 * @param language ISO 639-1 language code
 * @param availableVoices List of available Piper voices
 * @param preferredVoice Optional preferred voice ID to use if compatible
 * @returns Voice key that matches the language, or default voice
 */
export function selectPiperVoiceForLanguage(
  language: string,
  availableVoices: PiperVoice[],
  preferredVoice?: string
): string {
  if (availableVoices.length === 0) {
    return 'en_US-hfc_female-medium' // Fallback default
  }

  const normalizedLang = normalizeLanguageCode(language)

  // Check if preferred voice is compatible with the language
  if (preferredVoice) {
    const preferredVoiceObj = availableVoices.find((v) => v.key === preferredVoice)
    if (preferredVoiceObj) {
      const voiceLang = normalizeLanguageCode(preferredVoiceObj.language)
      if (voiceLang === normalizedLang) {
        return preferredVoice
      }
    }
  }

  // Find voices that match the language
  const matchingVoices = availableVoices.filter((voice) => {
    const voiceLang = normalizeLanguageCode(voice.language)
    return voiceLang === normalizedLang
  })

  if (matchingVoices.length > 0) {
    // Prefer medium quality if available, otherwise first match
    const mediumQuality = matchingVoices.find((v) => v.quality === 'medium')
    return mediumQuality ? mediumQuality.key : matchingVoices[0].key
  }

  // No match found, try to find any English voice as fallback
  const englishVoices = availableVoices.filter((voice) => {
    const voiceLang = normalizeLanguageCode(voice.language)
    return voiceLang === 'en'
  })

  if (englishVoices.length > 0) {
    return englishVoices[0].key
  }

  // Last resort: return first available voice
  return availableVoices[0].key
}

/**
 * Get a list of Kokoro voices compatible with a language
 */
export function getKokoroVoicesForLanguage(language: string): VoiceId[] {
  const normalizedLang = language.toLowerCase().trim()

  // Try exact match
  if (KOKORO_LANGUAGE_MAP[normalizedLang]) {
    return KOKORO_LANGUAGE_MAP[normalizedLang]
  }

  // Try base language
  const baseLang = normalizedLang.split(/[-_]/)[0]
  if (KOKORO_LANGUAGE_MAP[baseLang]) {
    return KOKORO_LANGUAGE_MAP[baseLang]
  }

  // Fallback to English voices for unsupported languages
  return KOKORO_LANGUAGE_MAP['en']
}

/**
 * Get a list of Piper voices compatible with a language
 */
export function getPiperVoicesForLanguage(
  language: string,
  availableVoices: PiperVoice[]
): PiperVoice[] {
  const normalizedLang = normalizeLanguageCode(language)

  return availableVoices.filter((voice) => {
    const voiceLang = normalizeLanguageCode(voice.language)
    return voiceLang === normalizedLang
  })
}
