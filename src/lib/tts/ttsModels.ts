/**
 * TTS engine module.
 *
 * The seam between the app and the speech engines. A caller asks for audio for
 * some text and a voice; the engine decides how to produce it, including which
 * weights to load and in what precision.
 *
 * Callers only fill in `TTSRequest`. Engine-specific knobs live in
 * `TTSEngineConfig`, which each engine reads for itself and ignores the rest.
 *
 * What an engine can do is declared once, as `TTSCapabilities`: a caller asks
 * whether the engine speaks a language or how it improves quality, instead of
 * comparing the engine's name. A fourth engine is one loader and one
 * capabilities entry.
 */

import { normalizeLanguageCode, POCKET_VOICES } from '../utils/voiceSelector'
import { listVoices as listKokoroVoices } from '../kokoro/kokoroVoices'
import { KITTEN_VOICES } from '../kitten/kittenVoices'

export type TTSModelType = 'kokoro' | 'piper' | 'pocket' | 'kitten'

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

const CAPABILITIES: Record<TTSModelType, TTSCapabilities> = {
  kokoro: { languages: ['en'], qualityLadder: 'quantization' },
  piper: { languages: 'catalogue', qualityLadder: 'voices' },
  pocket: { languages: ['en'], qualityLadder: 'single' },
  kitten: { languages: ['en'], qualityLadder: 'single' },
}

/** What the engine can do. Synchronous, for callers that only have the name. */
export function engineCapabilities(model: TTSModelType): TTSCapabilities {
  return CAPABILITIES[model]
}

/** Does the engine cover the language? */
export function engineSupportsLanguage(model: TTSModelType, language: string): boolean {
  const { languages } = engineCapabilities(model)
  if (languages === 'catalogue') return true
  return languages.includes(normalizeLanguageCode(language))
}

/** The voices the engine ships with, or undefined when it gets them elsewhere. */
export function engineVoices(model: TTSModelType): string[] | undefined {
  if (model === 'pocket') return POCKET_VOICES
  if (model === 'kitten') return [...KITTEN_VOICES]
  if (model === 'kokoro') return listKokoroVoices()
  return undefined
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

type EngineAdapter = Omit<TTSEngine, 'id' | 'capabilities'>

// A switch, not a string-indexed map: modelType can come from stored book
// data, so only these three names may ever be dispatched on.
async function loadEngine(
  modelType: TTSModelType,
  config: TTSEngineConfig
): Promise<EngineAdapter> {
  switch (modelType) {
    case 'kokoro': {
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
    }

    case 'piper': {
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
    }

    case 'pocket': {
      const { getPocketEngine } = await import('../pocket/pocketEngine')
      return getPocketEngine()
    }

    case 'kitten': {
      const { getKittenEngine } = await import('../kitten/kittenEngine')
      return getKittenEngine()
    }

    default:
      throw new Error(`Unknown TTS model type: ${modelType}`)
  }
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
  const adapter = await loadEngine(modelType, config)
  return Object.assign(adapter, {
    id: modelType,
    capabilities: engineCapabilities(modelType),
  })
}

/**
 * Model metadata for UI display
 */
export interface TTSModelInfo {
  id: TTSModelType
  name: string
  description: string
  requiresDownload: boolean
  supportsOffline: boolean
}

export const TTS_MODELS: TTSModelInfo[] = [
  {
    id: 'kokoro',
    name: 'Kokoro TTS',
    description: 'High-quality neural TTS (requires model download)',
    requiresDownload: true,
    supportsOffline: true,
  },
  {
    id: 'piper',
    name: 'Piper TTS',
    description: 'Fast, local neural TTS running in the browser.',
    requiresDownload: true,
    supportsOffline: true,
  },
  {
    id: 'pocket',
    name: 'Pocket TTS',
    description: "Kyutai's 18M parameter model, small enough to run on a phone.",
    requiresDownload: true,
    supportsOffline: true,
  },
  {
    id: 'kitten',
    name: 'KittenTTS',
    description: 'KittenML 15M parameter ONNX model, the smallest download here (25 MB).',
    requiresDownload: true,
    supportsOffline: true,
  },
]

/**
 * Get model info by ID
 */
export function getModelInfo(modelType: TTSModelType): TTSModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelType)
}
