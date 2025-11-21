/**
 * TTS Model Abstraction Layer
 * Provides a unified interface for different TTS engines
 */

export type TTSModelType = 'kokoro'

export interface TTSGenerateParams {
  text: string
  voice?: string
  speed?: number
  pitch?: number
  // Kokoro-specific
  model?: string
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
}

export interface TTSEngine {
  generateVoice(
    params: TTSGenerateParams,
    onChunkProgress?: (current: number, total: number) => void
  ): Promise<Blob>
}

/**
 * Get the appropriate TTS engine based on model type
 */
export async function getTTSEngine(modelType: TTSModelType): Promise<TTSEngine> {
  switch (modelType) {
    case 'kokoro': {
      const { generateVoice } = await import('../kokoro/kokoroClient')
      type KokoroVoiceId = Parameters<typeof generateVoice>[0]['voice']
      return {
        generateVoice: async (params, onChunkProgress) => {
          return generateVoice(
            {
              text: params.text,
              voice: params.voice as KokoroVoiceId,
              speed: params.speed,
              model: params.model,
              dtype: params.dtype,
            },
            onChunkProgress
          )
        },
      }
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
]

/**
 * Get model info by ID
 */
export function getModelInfo(modelType: TTSModelType): TTSModelInfo | undefined {
  return TTS_MODELS.find((m) => m.id === modelType)
}
