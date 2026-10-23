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

import { engineSupportsLanguage, fitVoiceFor, type TTSModelType } from '../tts/ttsModels'
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
 * The registry owns the rules: engines with special fitting carry them in
 * their entry, every other engine keeps the requested voice when its catalogue
 * knows it. A new engine is covered without a branch of its own.
 */
function pickVoice(
  input: ChapterPlanInput,
  model: TTSModelType,
  requestedVoice: string,
  hasChapterVoice: boolean
): string {
  return fitVoiceFor(model, input.language, requestedVoice, hasChapterVoice, {
    kokoroVoices: input.kokoroVoices,
    piperVoices: input.piperVoices,
  })
}
