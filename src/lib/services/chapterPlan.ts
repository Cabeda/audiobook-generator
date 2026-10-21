/**
 * Chapter plan.
 *
 * One place that decides how a chapter is read: which language, which engine,
 * which voice and with which settings.
 *
 * The rule is the same everywhere: a chapter's own override wins, then the
 * app's default for that language, then the global selection — and an engine
 * that does not cover the language falls back to Piper.
 */

import {
  isKokoroLanguageSupported,
  isPocketLanguageSupported,
  normalizeLanguageCode,
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
} from '../utils/voiceSelector'
import type { TTSModelType } from '../tts/ttsModels'
import type { PiperVoice } from '../piper/piperClient'
import type { Device, Quantization } from '../../stores/ttsStore'

export interface ChapterPlanInput {
  /** The chapter's own overrides. */
  chapter: { model?: string; voice?: string }
  /** The chapter's language, already resolved. */
  language: string
  /** The app's per-language defaults. */
  languageDefaults: Record<string, { model?: string; voice?: string } | undefined>
  /** The global selection. */
  selectedModel: string
  selectedVoice: string
  selectedQuantization?: Quantization
  selectedDevice?: Device
  /** Voices the engines can use. Used when the engine falls back. */
  kokoroVoices?: string[]
  piperVoices?: PiperVoice[]
  /** Constrained devices cap the weight precision. */
  isMobile?: boolean
}

export interface ChapterPlan {
  language: string
  model: TTSModelType
  voice: string
  quantization: Quantization
  device: Device
  /** True when the engine was switched because it does not cover the language. */
  isFallbackModel: boolean
}

/** Does the engine cover the language? */
export function engineSupportsLanguage(model: TTSModelType, language: string): boolean {
  if (model === 'kokoro') return isKokoroLanguageSupported(language)
  if (model === 'pocket') return isPocketLanguageSupported(language)
  return true
}

/**
 * Work out how a chapter is read.
 *
 * When the engine falls back to Piper, the voice has to be one Piper can use,
 * so the plan picks it from the Piper voices when they are known. Without
 * them the explicit voice is kept and the caller resolves it later.
 */
export function planChapter(input: ChapterPlanInput): ChapterPlan {
  const { chapter, language, languageDefaults, selectedModel, selectedVoice } = input
  const langDefault = languageDefaults[language]

  const requestedModel = (chapter.model || langDefault?.model || selectedModel) as TTSModelType
  const isFallbackModel = !engineSupportsLanguage(requestedModel, language)
  const model: TTSModelType = isFallbackModel ? 'piper' : requestedModel

  const explicitVoice = chapter.voice || langDefault?.voice || selectedVoice
  const voice = isFallbackModel ? pickFallbackVoice(input, model, explicitVoice) : explicitVoice

  return {
    language,
    model,
    voice,
    quantization: input.isMobile ? 'q4' : (input.selectedQuantization ?? 'q8'),
    device: input.selectedDevice ?? 'auto',
    isFallbackModel,
  }
}

/** A voice the fallback engine can actually speak. */
function pickFallbackVoice(
  input: ChapterPlanInput,
  model: TTSModelType,
  explicitVoice: string
): string {
  if (model === 'piper') {
    if (!input.piperVoices || input.piperVoices.length === 0) return explicitVoice
    // Keep the voice when Piper can use it for this language.
    const usable = input.piperVoices.some(
      (voice) =>
        voice.key === explicitVoice &&
        normalizeLanguageCode(voice.language) === normalizeLanguageCode(input.language)
    )
    if (usable) return explicitVoice
    return selectPiperVoiceForLanguage(input.language, input.piperVoices)
  }

  if (model === 'kokoro') {
    if (!input.kokoroVoices || input.kokoroVoices.length === 0) return explicitVoice
    const voice = selectKokoroVoiceForLanguage(input.language)
    return input.kokoroVoices.includes(voice) ? voice : input.kokoroVoices[0]
  }

  return explicitVoice
}
