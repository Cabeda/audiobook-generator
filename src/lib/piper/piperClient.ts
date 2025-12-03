import * as tts from '@diffusionstudio/vits-web'
import logger from '../utils/logger'

export interface PiperVoice {
  key: string
  name: string
  language: string
  quality: string
}

export class PiperClient {
  private static instance: PiperClient
  private initialized = false

  private constructor() {}

  static getInstance(): PiperClient {
    if (!PiperClient.instance) {
      PiperClient.instance = new PiperClient()
    }
    return PiperClient.instance
  }

  async getVoices(): Promise<PiperVoice[]> {
    const voicesMap = await tts.voices()
    return Object.entries(voicesMap).map(([key, data]: [string, any]) => {
      // If voicesMap is an array, key is an index. Use data.key if available.
      const voiceId = Array.isArray(voicesMap) && data.key ? data.key : key
      return {
        key: voiceId,
        name: data.name,
        language: data.language.name_native,
        quality: data.quality,
      }
    })
  }

  async generate(
    text: string,
    options: {
      voiceId?: string
      onProgress?: (msg: string) => void
    } = {}
  ): Promise<Blob> {
    const voiceId = options.voiceId || 'en_US-hfc_female-medium'
    logger.info('Piper generate called with voiceId:', voiceId)

    // Check if model is stored
    const storedModels = await tts.stored()
    logger.info('Piper stored models:', storedModels)
    const isStored = storedModels.includes(voiceId as any)

    if (!isStored) {
      logger.info(`Model ${voiceId} not stored, downloading...`)
      options.onProgress?.(`Downloading voice model: ${voiceId}...`)
      await tts.download(voiceId as any, (progress: any) => {
        const percent = Math.round((progress.loaded * 100) / progress.total)
        options.onProgress?.(`Downloading model: ${percent}%`)
      })
    }

    options.onProgress?.('Generating audio...')

    try {
      logger.info('Calling tts.predict with:', { text, voiceId })
      const wav = await tts.predict({
        text,
        voiceId: voiceId as any,
      })

      return wav
    } catch (err) {
      logger.error('Piper generation failed:', err)
      throw err
    }
  }
}

export const piperClient = PiperClient.getInstance()

export async function generateVoice(
  params: {
    text: string
    voice?: string
    speed?: number // Piper doesn't support speed directly in predict yet, but we keep interface
  },
  onChunkProgress?: (current: number, total: number) => void, // Not supported by Piper
  onProgress?: (status: string) => void
): Promise<Blob> {
  return piperClient.generate(params.text, {
    voiceId: params.voice,
    onProgress,
  })
}
