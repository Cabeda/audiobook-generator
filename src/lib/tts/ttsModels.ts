/**
 * TTS engine module.
 *
 * The seam between the app and the speech engines. A caller asks for audio for
 * some text and a voice; the engine decides how to produce it, including which
 * weights to load and in what precision.
 *
 * Callers only fill in `TTSRequest`. Engine-specific knobs live in
 * `TTSEngineConfig`, which each engine reads for itself and ignores the rest.
 */

export type TTSModelType = 'kokoro' | 'piper' | 'pocket'

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

export interface TTSEngine {
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
 * Get the appropriate TTS engine based on model type.
 *
 * The config is read by the engine, not by the caller: it carries the knobs
 * only that engine understands.
 */
export async function getTTSEngine(
  modelType: TTSModelType,
  config: TTSEngineConfig = {}
): Promise<TTSEngine> {
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
        generateVoice: (request, onChunkProgress, onProgress) =>
          generateVoice(kokoroRequest(request), onChunkProgress, onProgress),
        generateSegments: (request, onChunkProgress, onProgress) =>
          generateVoiceSegments(kokoroRequest(request), onChunkProgress, onProgress),
      }
    }
    case 'piper': {
      const { generateVoice } = await import('../piper/piperClient')
      return {
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
      const { createPocketEngine } = await import('../pocket/pocketEngine')
      return createPocketEngine()
    }
    default:
      throw new Error(`Unknown TTS model type: ${modelType}`)
  }
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
]

/**
 * Get model info by ID
 */
export function getModelInfo(modelType: TTSModelType): TTSModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelType)
}
