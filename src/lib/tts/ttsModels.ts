/**
 * TTS engine registry.
 *
 * The seam between the app and the speech engines. A caller asks for audio for
 * some text and a voice; the engine decides how to produce it, including which
 * weights to load and in what precision.
 *
 * ENGINES below is the only place an engine exists: one entry carries its
 * capabilities, its UI metadata, its voice catalogue, how a voice is fitted to
 * a language, the settings it is benchmarked with, and its loader. Every type,
 * every picker list and every dispatch in the app is derived from that entry,
 * so adding an engine is adding one entry (plus its catalogue module).
 *
 * Callers only fill in `TTSRequest`. Engine-specific knobs live in
 * `TTSEngineConfig`, which each engine reads for itself and ignores the rest.
 * What an engine can do is declared once, as `TTSCapabilities`: a caller asks
 * whether the engine speaks a language or how it improves quality, instead of
 * comparing the engine's name.
 */

import {
  getPiperVoicesForLanguage,
  normalizeLanguageCode,
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
  POCKET_VOICES,
} from '../utils/voiceSelector'
import { listVoices as listKokoroVoices, voiceLabels } from '../kokoro/kokoroVoices'
import { KITTEN_VOICES } from '../kitten/kittenVoices'
import { POCKET_VOICE_LABELS } from '../pocket/pocketAssets'
import type { PiperVoice } from '../piper/piperClient'

/** What every caller knows about a request. */
export interface TTSRequest {
  text: string
  voice?: string
  speed?: number
  pitch?: number
  /** ISO 639-1 language code, for engines that pick a voice by language. */
  language?: string
}

/**
 * Knobs that only some engines understand. Each engine reads what is its own
 * and ignores the rest, so no caller has to know which engine is in use.
 */
export interface TTSEngineConfig {
  /** Kokoro: weight precision. */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  /** Kokoro: model id. */
  model?: string
  /** Kokoro: execution device. */
  device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
}

export interface TTSCapabilities {
  /**
   * ISO 639-1 codes the engine speaks. `'catalogue'` means every language a
   * voice exists for — the engine has no language of its own.
   */
  languages: 'catalogue' | string[]
  /**
   * How the engine gets better quality: a different weight precision, a better
   * voice, or not at all.
   */
  qualityLadder: 'quantization' | 'voices' | 'single'
}

/** What a picker can select: an engine, or the browser's own speech. */
export type SelectedModel = TTSModelType | 'web_speech'

/** Catalogues a caller may already have downloaded, for voice fitting. */
export interface VoiceCatalogues {
  /** Known Kokoro voice ids, when the caller validated against them. */
  kokoroVoices?: string[]
  /** Downloaded Piper voices, whose language fields drive the fit. */
  piperVoices?: PiperVoice[]
}

/**
 * Fit a voice to a language: keep the person's choice when the engine can use
 * it, otherwise pick one that speaks the language.
 */
type FitVoice = (
  language: string,
  requestedVoice: string,
  hasExplicitVoice: boolean,
  catalogues: VoiceCatalogues
) => string

interface EngineDefinition {
  capabilities: TTSCapabilities
  /** UI metadata for pickers and the settings page. */
  info: {
    name: string
    description: string
    requiresDownload: boolean
    supportsOffline: boolean
  }
  /** The catalogue the engine ships with, when it has one. */
  voices?: () => string[]
  /** Display labels for catalogue voices, when they have names. */
  voiceLabels?: () => Record<string, string>
  /** Language-aware voice fitting, when the default rule is not enough. */
  fitVoice?: FitVoice
  /** Settings the engine is measured with in the benchmark. */
  benchmark?: TTSEngineConfig
  /** The adapter that produces audio. */
  load: (config: TTSEngineConfig) => Promise<EngineAdapter>
}

type EngineAdapter = Omit<TTSEngine, 'id' | 'capabilities'>

// ---------------------------------------------------------------------------
// The registry. Add an engine here — nothing else in the app needs an edit.
// ---------------------------------------------------------------------------

const KOKORO: EngineDefinition = {
  capabilities: { languages: ['en'], qualityLadder: 'quantization' },
  info: {
    name: 'Kokoro TTS',
    description: 'High-quality neural TTS (requires model download)',
    requiresDownload: true,
    supportsOffline: true,
  },
  voices: () => listKokoroVoices(),
  voiceLabels: () => voiceLabels,
  fitVoice: (language, requestedVoice, _hasExplicitVoice, catalogues) => {
    const voice = selectKokoroVoiceForLanguage(language, requestedVoice)
    const known = catalogues.kokoroVoices
    if (known && known.length > 0 && !known.includes(voice)) return known[0]
    return voice
  },
  // The benchmark runs on the CPU, so WebGPU is not part of the comparison.
  benchmark: { model: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8', device: 'wasm' },
  load: async (config) => {
    const { generateVoice, generateVoiceSegments } = await import('../kokoro/kokoroClient')
    type KokoroVoiceId = Parameters<typeof generateVoice>[0]['voice']
    const kokoroRequest = (request: TTSRequest) => ({
      text: request.text,
      voice: request.voice as KokoroVoiceId,
      speed: request.speed,
      model: config.model,
      dtype: config.dtype,
      device: config.device,
    })
    return {
      warmUp: async () => {
        const { warmUpKokoro } = await import('../kokoro/kokoroClient')
        await warmUpKokoro(
          config.model ?? 'onnx-community/Kokoro-82M-v1.0-ONNX',
          config.dtype ?? 'q8',
          config.device ?? 'auto'
        )
      },
      generateVoice: (request, onChunkProgress, onProgress) =>
        generateVoice(kokoroRequest(request), onChunkProgress, onProgress),
      generateSegments: (request, onChunkProgress, onProgress) =>
        generateVoiceSegments(kokoroRequest(request), onChunkProgress, onProgress),
    }
  },
}

const PIPER: EngineDefinition = {
  capabilities: { languages: 'catalogue', qualityLadder: 'voices' },
  info: {
    name: 'Piper TTS',
    description: 'Fast, local neural TTS running in the browser.',
    requiresDownload: true,
    supportsOffline: true,
  },
  // Piper's catalogue is downloaded; callers pass it via VoiceCatalogues.
  fitVoice: (language, requestedVoice, hasExplicitVoice, catalogues) => {
    const voices = catalogues.piperVoices
    if (!voices || voices.length === 0) return requestedVoice
    const requested = requestedVoice
      ? voices.find((voice) => voice.key === requestedVoice)
      : undefined
    const fitsLanguage =
      requested !== undefined &&
      normalizeLanguageCode(requested.language) === normalizeLanguageCode(language)
    if (fitsLanguage) return requestedVoice
    if (hasExplicitVoice && requested !== undefined) return requestedVoice
    return selectPiperVoiceForLanguage(language, voices)
  },
  load: async () => {
    const { generateVoice } = await import('../piper/piperClient')
    return {
      warmUp: async () => {
        // Piper loads its model on the first request; fetching the voice
        // list warms the catalogue in the meantime.
        const { PiperClient } = await import('../piper/piperClient')
        await PiperClient.getInstance().getVoices()
      },
      generateVoice: (request, onChunkProgress, onProgress) =>
        generateVoice(
          {
            text: request.text,
            voice: request.voice,
            speed: request.speed,
          },
          onChunkProgress,
          onProgress
        ),
    }
  },
}

const POCKET: EngineDefinition = {
  capabilities: { languages: ['en'], qualityLadder: 'single' },
  info: {
    name: 'Pocket TTS',
    description: "Kyutai's 18M parameter model, small enough to run on a phone.",
    requiresDownload: true,
    supportsOffline: true,
  },
  voices: () => POCKET_VOICES,
  voiceLabels: () => POCKET_VOICE_LABELS,
  load: async () => {
    const { getPocketEngine } = await import('../pocket/pocketEngine')
    return getPocketEngine()
  },
}

const KITTEN: EngineDefinition = {
  capabilities: { languages: ['en'], qualityLadder: 'single' },
  info: {
    name: 'KittenTTS',
    description: 'KittenML 15M parameter ONNX model, the smallest download here (25 MB).',
    requiresDownload: true,
    supportsOffline: true,
  },
  voices: () => [...KITTEN_VOICES],
  load: async () => {
    const { getKittenEngine } = await import('../kitten/kittenEngine')
    return getKittenEngine()
  },
}

const ENGINES = {
  kokoro: KOKORO,
  piper: PIPER,
  pocket: POCKET,
  kitten: KITTEN,
}

/** The engines the app can load. Derived from the registry. */
export type TTSModelType = keyof typeof ENGINES

/** Every engine id, in registry order. */
export const TTS_MODEL_IDS = Object.keys(ENGINES) as TTSModelType[]

/** Is this stored string one of our engines? Use before dispatching on it. */
export function isTTSModelType(value: string): value is TTSModelType {
  return Object.prototype.hasOwnProperty.call(ENGINES, value)
}

/** The browser speaks instead of an engine. */
export function isBrowserSpeech(model: SelectedModel): model is 'web_speech' {
  return model === 'web_speech'
}

/** What the engine can do. Synchronous, for callers that only have the name. */
export function engineCapabilities(model: TTSModelType): TTSCapabilities {
  return ENGINES[model].capabilities
}

/** Does the engine cover the language? Unknown ids cover nothing. */
export function engineSupportsLanguage(model: TTSModelType, language: string): boolean {
  const capabilities = ENGINES[model]?.capabilities
  if (!capabilities) return false
  if (capabilities.languages === 'catalogue') return true
  return capabilities.languages.includes(normalizeLanguageCode(language))
}

/** The voices the engine ships with, or undefined when it gets them elsewhere. */
export function engineVoices(model: TTSModelType): string[] | undefined {
  return ENGINES[model].voices?.()
}

/** One entry of a voice picker. */
export interface VoiceOption {
  id: string
  label: string
}

/**
 * The voices a picker should offer, for an engine and a language.
 *
 * This is the only place a picker asks, so a new engine shows up in every
 * picker as soon as it is in the registry — capabilities and voices — with no
 * component changes. Piper is the one exception: its catalogue is downloaded,
 * so the caller passes whatever it has. Web Speech voices come from the
 * browser and are not ours to list.
 */
export function voiceOptionsFor(
  model: SelectedModel,
  language: string = 'en',
  piperVoices: PiperVoice[] = []
): VoiceOption[] {
  if (isBrowserSpeech(model)) return []
  // A picker may hand over a stale or empty id (selects bind '' for 'app
  // default'); an unknown engine offers no voices instead of throwing.
  if (!isTTSModelType(model)) return []

  if (model === 'piper') {
    return getPiperVoicesForLanguage(language, piperVoices).map((voice) => ({
      id: voice.key,
      label: voice.name,
    }))
  }

  if (!engineSupportsLanguage(model, language)) return []

  const labels = ENGINES[model].voiceLabels?.()
  return (engineVoices(model) ?? []).map((id) => ({ id, label: labels?.[id] ?? id }))
}

/**
 * The voice a chapter should be read with.
 *
 * A voice explicitly chosen for the chapter is kept even when its language
 * differs — the person asked for it. Everything else is a default and may be
 * replaced by one that fits the language. Engines with special fitting rules
 * carry them in their registry entry; every other engine keeps the voice the
 * person asked for when its catalogue knows it, otherwise takes its first.
 */
export function fitVoiceFor(
  model: TTSModelType,
  language: string,
  requestedVoice: string,
  hasExplicitVoice: boolean,
  catalogues: VoiceCatalogues = {}
): string {
  const fit = ENGINES[model].fitVoice
  if (fit) return fit(language, requestedVoice, hasExplicitVoice, catalogues)

  const catalogue = engineVoices(model)
  if (!catalogue || catalogue.length === 0) return requestedVoice
  return requestedVoice && catalogue.includes(requestedVoice) ? requestedVoice : catalogue[0]
}

/** Settings the engine is measured with in the benchmark. */
export function defaultEngineConfig(model: TTSModelType): TTSEngineConfig {
  return ENGINES[model].benchmark ?? {}
}

export interface TTSEngine {
  readonly id: TTSModelType
  readonly capabilities: TTSCapabilities

  /**
   * Load the model ahead of time, so the first request does not pay for the
   * download. Engines that cannot do it simply leave it out.
   */
  warmUp?(): Promise<void>

  generateVoice(
    request: TTSRequest,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<Blob>

  generateSegments?(
    request: TTSRequest,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<{ text: string; blob: Blob }[]>
}

/**
 * Get the TTS engine for a model.
 *
 * The config is read by the engine, not by the caller: it carries the knobs
 * only that engine understands. The engine carries its own name and
 * capabilities, so a caller never has to pass the name around.
 */
export async function getTTSEngine(
  modelType: TTSModelType,
  config: TTSEngineConfig = {}
): Promise<TTSEngine> {
  // modelType can come from stored book data, so dispatch only on known ids.
  if (!isTTSModelType(modelType)) {
    throw new Error(`Unknown TTS model type: ${modelType}`)
  }
  const adapter = await ENGINES[modelType].load(config)
  return Object.assign(adapter, {
    id: modelType,
    capabilities: engineCapabilities(modelType),
  })
}

/** Model metadata for UI display. Derived from the registry. */
export interface TTSModelInfo {
  id: TTSModelType
  name: string
  description: string
  requiresDownload: boolean
  supportsOffline: boolean
}

export const TTS_MODELS: TTSModelInfo[] = TTS_MODEL_IDS.map((id) => ({ id, ...ENGINES[id].info }))

/** What every model picker offers, in display order. */
export const MODEL_OPTIONS: { id: SelectedModel; name: string }[] = [
  { id: 'web_speech', name: 'Web Speech API' },
  ...TTS_MODELS.map((model) => ({ id: model.id, name: model.name })),
]

/** Model metadata by id. */
export function getModelInfo(modelType: TTSModelType): TTSModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelType)
}
