/**
 * TTS Model Abstraction Layer
 * Provides a unified interface for different TTS engines
 */

export type TTSModelType = 'kokoro' | 'piper' | 'web_speech'

export interface TTSGenerateParams {
  text: string
  voice?: string
  speed?: number
  pitch?: number
  // Kokoro-specific
  model?: string
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
  device?: 'wasm' | 'webgpu' | 'cpu' | 'auto'
}

export interface TTSEngine {
  generateVoice(
    params: TTSGenerateParams,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<Blob>

  generateSegments?(
    params: TTSGenerateParams,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<{ text: string; blob: Blob }[]>
}

/**
 * Get the appropriate TTS engine based on model type
 */
export async function getTTSEngine(modelType: TTSModelType): Promise<TTSEngine> {
  switch (modelType) {
    case 'kokoro': {
      const { generateVoice, generateVoiceSegments } = await import('../kokoro/kokoroClient')
      type KokoroVoiceId = Parameters<typeof generateVoice>[0]['voice']
      return {
        generateVoice: async (params, onChunkProgress, onProgress) => {
          return generateVoice(
            {
              text: params.text,
              voice: params.voice as KokoroVoiceId,
              speed: params.speed,
              model: params.model,
              dtype: params.dtype,
              device: params.device,
            },
            onChunkProgress,
            onProgress
          )
        },
        generateSegments: async (params, onChunkProgress, onProgress) => {
          return generateVoiceSegments(
            {
              text: params.text,
              voice: params.voice as KokoroVoiceId,
              speed: params.speed,
              model: params.model,
              dtype: params.dtype,
              device: params.device,
            },
            onChunkProgress,
            onProgress
          )
        },
      }
    }
    case 'piper': {
      const { generateVoice } = await import('../piper/piperClient')
      return {
        generateVoice: async (params, onChunkProgress, onProgress) => {
          return generateVoice(
            {
              text: params.text,
              voice: params.voice,
              speed: params.speed,
            },
            onChunkProgress,
            onProgress
          )
        },
      }
    }
    case 'web_speech': {
      throw new Error('Web Speech API does not support file generation')
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
    id: 'web_speech',
    name: 'Web Speech API',
    description: 'Uses system voices. Fast, no download required. (Playback only)',
    requiresDownload: false,
    supportsOffline: true,
  },
]

/**
 * Get model info by ID
 */
export function getModelInfo(modelType: TTSModelType): TTSModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelType)
}
