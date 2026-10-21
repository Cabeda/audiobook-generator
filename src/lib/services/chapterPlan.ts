/**
 * Chapter plan.
 *
 * One place that decides how a chapter is read: which language, which engine,
 * which voice and with which settings.
 *
 * The rule is the same everywhere: a chapter's own override wins, then the
 * app's default for that language, then the global selection — and an engine
 * that does not cover the language falls back to Piper. The voice is part of
 * the same answer, so the reader, the generator and the chapter list cannot
 * disagree about who says the words.
 */

import {
  isKokoroLanguageSupported,
  isPocketLanguageSupported,
  normalizeLanguageCode,
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
  selectPocketVoiceForLanguage,
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
  /** Voices the engines can use. Without them the requested voice is kept. */
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
  /** True when a stored segment was made with a different plan. */
  isMismatched(segment: { voice?: string | null; model?: string | null }): boolean
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

  const requestedVoice = chapter.voice || langDefault?.voice || selectedVoice
  const voice = pickVoice(input, model, requestedVoice, Boolean(chapter.voice))

  return {
    language,
    model,
    voice,
    quantization: input.isMobile ? 'q4' : (input.selectedQuantization ?? 'q8'),
    device: input.selectedDevice ?? 'auto',
    isFallbackModel,
    isMismatched: (segment) =>
      (segment.voice != null && segment.voice !== voice) ||
      (segment.model != null && segment.model !== model),
  }
}

/**
 * A voice the chosen engine can actually speak.
 *
 * A voice explicitly chosen for the chapter is kept even when its language
 * differs — the person asked for it. Everything else is a default and may be
 * replaced by one that fits the language.
 */
function pickVoice(
  input: ChapterPlanInput,
  model: TTSModelType,
  requestedVoice: string,
  hasChapterVoice: boolean
): string {
  if (model === 'piper') {
    const voices = input.piperVoices
    if (!voices || voices.length === 0) return requestedVoice
    const requested = requestedVoice
      ? voices.find((voice) => voice.key === requestedVoice)
      : undefined
    const fitsLanguage =
      requested !== undefined &&
      normalizeLanguageCode(requested.language) === normalizeLanguageCode(input.language)
    if (fitsLanguage) return requestedVoice
    if (hasChapterVoice && requested !== undefined) return requestedVoice
    return selectPiperVoiceForLanguage(input.language, voices)
  }

  if (model === 'kokoro') {
    const voice = selectKokoroVoiceForLanguage(input.language, requestedVoice)
    const known = input.kokoroVoices
    if (known && known.length > 0 && !known.includes(voice)) return known[0]
    return voice
  }

  if (model === 'pocket') {
    return selectPocketVoiceForLanguage(input.language, requestedVoice)
  }

  return requestedVoice
}
