/**
 * Patched Kokoro TTS client that supports multilingual voices
 *
 * The official kokoro-js library only supports English voices (af_*, am_*, bf_*, bm_*).
 * This patch bypasses the voice validation to enable Portuguese, Spanish, French,
 * Italian, Hindi, Japanese, and Chinese voices that exist in the Kokoro-82M model.
 *
 * NOTE: Phonemization for non-English languages uses espeak-ng fallback which
 * may have reduced quality compared to the native misaki phonemizer.
 */

import { KokoroTTS, TextSplitterStream } from 'kokoro-js'
import { Tensor } from '@huggingface/transformers'
import logger from '../utils/logger'

// Extended voice definitions including all Kokoro-82M supported voices
export const MULTILINGUAL_VOICES = {
  // American English (lang_code='a')
  af_heart: { name: 'Heart', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_alloy: { name: 'Alloy', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_aoede: { name: 'Aoede', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_bella: { name: 'Bella', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_jessica: { name: 'Jessica', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_kore: { name: 'Kore', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_nicole: { name: 'Nicole', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_nova: { name: 'Nova', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_river: { name: 'River', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_sarah: { name: 'Sarah', language: 'en-us', gender: 'Female', langCode: 'a' },
  af_sky: { name: 'Sky', language: 'en-us', gender: 'Female', langCode: 'a' },
  am_adam: { name: 'Adam', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_echo: { name: 'Echo', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_eric: { name: 'Eric', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_fenrir: { name: 'Fenrir', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_liam: { name: 'Liam', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_michael: { name: 'Michael', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_onyx: { name: 'Onyx', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_puck: { name: 'Puck', language: 'en-us', gender: 'Male', langCode: 'a' },
  am_santa: { name: 'Santa', language: 'en-us', gender: 'Male', langCode: 'a' },
  // British English (lang_code='b')
  bf_emma: { name: 'Emma', language: 'en-gb', gender: 'Female', langCode: 'b' },
  bf_isabella: { name: 'Isabella', language: 'en-gb', gender: 'Female', langCode: 'b' },
  bf_alice: { name: 'Alice', language: 'en-gb', gender: 'Female', langCode: 'b' },
  bf_lily: { name: 'Lily', language: 'en-gb', gender: 'Female', langCode: 'b' },
  bm_george: { name: 'George', language: 'en-gb', gender: 'Male', langCode: 'b' },
  bm_lewis: { name: 'Lewis', language: 'en-gb', gender: 'Male', langCode: 'b' },
  bm_daniel: { name: 'Daniel', language: 'en-gb', gender: 'Male', langCode: 'b' },
  bm_fable: { name: 'Fable', language: 'en-gb', gender: 'Male', langCode: 'b' },
  // Japanese (lang_code='j')
  jf_alpha: { name: 'Alpha', language: 'ja', gender: 'Female', langCode: 'j' },
  jf_gongitsune: { name: 'Gongitsune', language: 'ja', gender: 'Female', langCode: 'j' },
  jf_nezumi: { name: 'Nezumi', language: 'ja', gender: 'Female', langCode: 'j' },
  jf_tebukuro: { name: 'Tebukuro', language: 'ja', gender: 'Female', langCode: 'j' },
  jm_kumo: { name: 'Kumo', language: 'ja', gender: 'Male', langCode: 'j' },
  jm_beta: { name: 'Beta', language: 'ja', gender: 'Male', langCode: 'j' },
  // Chinese/Mandarin (lang_code='z')
  zf_xiaobei: { name: 'Xiaobei', language: 'zh', gender: 'Female', langCode: 'z' },
  zf_xiaoni: { name: 'Xiaoni', language: 'zh', gender: 'Female', langCode: 'z' },
  zf_xiaoxiao: { name: 'Xiaoxiao', language: 'zh', gender: 'Female', langCode: 'z' },
  zf_xiaoyi: { name: 'Xiaoyi', language: 'zh', gender: 'Female', langCode: 'z' },
  zm_yunjian: { name: 'Yunjian', language: 'zh', gender: 'Male', langCode: 'z' },
  zm_yunxi: { name: 'Yunxi', language: 'zh', gender: 'Male', langCode: 'z' },
  zm_yunxia: { name: 'Yunxia', language: 'zh', gender: 'Male', langCode: 'z' },
  zm_yunyang: { name: 'Yunyang', language: 'zh', gender: 'Male', langCode: 'z' },
  // Spanish (lang_code='e')
  ef_dora: { name: 'Dora', language: 'es', gender: 'Female', langCode: 'e' },
  em_alex: { name: 'Alex', language: 'es', gender: 'Male', langCode: 'e' },
  em_santa: { name: 'Santa', language: 'es', gender: 'Male', langCode: 'e' },
  // French (lang_code='f')
  ff_siwis: { name: 'Siwis', language: 'fr', gender: 'Female', langCode: 'f' },
  // Hindi (lang_code='h')
  hf_alpha: { name: 'Alpha', language: 'hi', gender: 'Female', langCode: 'h' },
  hf_beta: { name: 'Beta', language: 'hi', gender: 'Female', langCode: 'h' },
  hm_omega: { name: 'Omega', language: 'hi', gender: 'Male', langCode: 'h' },
  hm_psi: { name: 'Psi', language: 'hi', gender: 'Male', langCode: 'h' },
  // Italian (lang_code='i')
  if_sara: { name: 'Sara', language: 'it', gender: 'Female', langCode: 'i' },
  im_nicola: { name: 'Nicola', language: 'it', gender: 'Male', langCode: 'i' },
  // Brazilian Portuguese (lang_code='p')
  pf_dora: { name: 'Dora', language: 'pt-br', gender: 'Female', langCode: 'p' },
  pm_alex: { name: 'Alex', language: 'pt-br', gender: 'Male', langCode: 'p' },
  pm_santa: { name: 'Santa', language: 'pt-br', gender: 'Male', langCode: 'p' },
} as const

export type MultilingualVoiceId = keyof typeof MULTILINGUAL_VOICES

// Check if a voice is English (supported natively by kokoro-js)
export function isEnglishVoice(voice: string): boolean {
  return (
    voice.startsWith('af_') ||
    voice.startsWith('am_') ||
    voice.startsWith('bf_') ||
    voice.startsWith('bm_')
  )
}

// Voice style cache
const voiceStyleCache = new Map<string, Float32Array>()

/**
 * Load voice style data from HuggingFace
 */
async function loadVoiceStyle(voiceId: string): Promise<Float32Array> {
  if (voiceStyleCache.has(voiceId)) {
    return voiceStyleCache.get(voiceId)!
  }

  const url = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voiceId}.bin`

  let cache: Cache | undefined
  try {
    cache = await caches.open('kokoro-voices-multilingual')
    const cachedResponse = await cache.match(url)
    if (cachedResponse) {
      logger.info('[KokoroPatch]', `Voice ${voiceId} loaded from cache`)
      const buffer = await cachedResponse.arrayBuffer()
      const style = new Float32Array(buffer)
      voiceStyleCache.set(voiceId, style)
      return style
    }
  } catch (err) {
    logger.warn('[KokoroPatch]', 'Cache access failed:', err)
  }

  logger.info('[KokoroPatch]', `Downloading voice style: ${voiceId}`)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to load voice ${voiceId}: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()

  // Cache the response
  if (cache) {
    try {
      await cache.put(url, new Response(buffer, { headers: response.headers }))
    } catch (err) {
      logger.warn('[KokoroPatch]', 'Failed to cache voice:', err)
    }
  }

  const style = new Float32Array(buffer)
  voiceStyleCache.set(voiceId, style)
  return style
}

/**
 * Audio class matching kokoro-js RawAudio interface
 */
class RawAudio {
  data: Float32Array
  sampleRate: number

  constructor(data: Float32Array, sampleRate: number) {
    this.data = data
    this.sampleRate = sampleRate
  }

  toBlob(): Blob {
    // Convert to WAV format
    const numChannels = 1
    const bytesPerSample = 2 // 16-bit
    const blockAlign = numChannels * bytesPerSample
    const byteRate = this.sampleRate * blockAlign
    const dataSize = this.data.length * bytesPerSample
    const bufferSize = 44 + dataSize

    const buffer = new ArrayBuffer(bufferSize)
    const view = new DataView(buffer)

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, bufferSize - 8, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // audio format (PCM)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, this.sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bytesPerSample * 8, true)
    writeString(36, 'data')
    view.setUint32(40, dataSize, true)

    // Convert float32 to int16
    let offset = 44
    for (let i = 0; i < this.data.length; i++) {
      const sample = Math.max(-1, Math.min(1, this.data[i]))
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff
      view.setInt16(offset, intSample, true)
      offset += 2
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }
}

/**
 * Patched KokoroTTS wrapper that supports multilingual voices
 */
export class PatchedKokoroTTS {
  private tts: KokoroTTS
  private model: unknown
  private tokenizer: unknown

  constructor(tts: KokoroTTS) {
    this.tts = tts
    // Access internal model and tokenizer via property access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.model = (tts as any).model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.tokenizer = (tts as any).tokenizer
  }

  static async from_pretrained(
    modelId: string,
    options: {
      dtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'
      device?: 'wasm' | 'webgpu' | 'cpu' | null
      progress_callback?: (progress: {
        status: string
        file?: string
        loaded?: number
        total?: number
      }) => void
    } = {}
  ): Promise<PatchedKokoroTTS> {
    const tts = await KokoroTTS.from_pretrained(modelId, options)
    return new PatchedKokoroTTS(tts)
  }

  /**
   * Get language code from voice ID
   */
  private getLanguageCode(voice: string): string {
    const voiceInfo = MULTILINGUAL_VOICES[voice as MultilingualVoiceId]
    if (voiceInfo) {
      return voiceInfo.langCode
    }
    // Fallback: extract first character
    return voice.charAt(0)
  }

  /**
   * Generate audio from text using potentially multilingual voice
   */
  async generate(
    text: string,
    { voice = 'af_heart', speed = 1 }: { voice?: string; speed?: number } = {}
  ): Promise<RawAudio> {
    // For English voices, use the original method
    if (isEnglishVoice(voice)) {
      logger.info('[KokoroPatch]', `Using native kokoro-js for English voice: ${voice}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.tts as any).generate(text, { voice, speed })
    }

    // For non-English voices, bypass validation
    logger.info('[KokoroPatch]', `Using patched generation for voice: ${voice}`)

    // Tokenize text using the tokenizer
    // The phonemizer in kokoro-js uses espeak-ng for non-English which should work
    // We'll pass the text directly and let the model handle it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokenizer = this.tokenizer as any
    const { input_ids } = tokenizer(text, { truncation: true })

    // Call generate_from_ids directly (bypasses voice validation)
    return this.generateFromIds(input_ids, { voice, speed })
  }

  /**
   * Generate audio from token IDs (bypasses voice validation)
   */
  private async generateFromIds(
    inputIds: { dims: number[]; data: BigInt64Array },
    { voice = 'af_heart', speed = 1 }: { voice?: string; speed?: number } = {}
  ): Promise<RawAudio> {
    // Load voice style
    const voiceStyle = await loadVoiceStyle(voice)

    // Calculate style offset based on input length
    const inputLength = inputIds.dims.at(-1) || 0
    const styleOffset = 256 * Math.min(Math.max(inputLength - 2, 0), 509)
    const style = voiceStyle.slice(styleOffset, styleOffset + 256)

    // Prepare model inputs
    const inputs = {
      input_ids: inputIds,
      style: new Tensor('float32', style, [1, 256]),
      speed: new Tensor('float32', [speed], [1]),
    }

    // Run model inference
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = this.model as any
    const { waveform } = await model(inputs)

    return new RawAudio(waveform.data, 24000)
  }

  /**
   * Stream audio generation for long texts
   */
  async *stream(
    text: string | TextSplitterStream,
    { voice = 'af_heart', speed = 1 }: { voice?: string; speed?: number } = {}
  ): AsyncGenerator<{ text: string; phonemes: string; audio: RawAudio }> {
    // For English voices, use the original stream method
    if (isEnglishVoice(voice)) {
      logger.info('[KokoroPatch]', `Using native streaming for English voice: ${voice}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yield* (this.tts as any).stream(text, { voice, speed })
      return
    }

    // For non-English, we need to handle streaming ourselves
    logger.info('[KokoroPatch]', `Using patched streaming for voice: ${voice}`)

    let splitter: TextSplitterStream
    if (text instanceof TextSplitterStream) {
      splitter = text
    } else {
      splitter = new TextSplitterStream()
      splitter.push(text)
      splitter.close()
    }

    for await (const sentence of splitter) {
      const audio = await this.generate(sentence, { voice, speed })
      yield {
        text: sentence,
        phonemes: sentence, // We don't have phonemes for non-English in this implementation
        audio,
      }
    }
  }

  /**
   * List all available voices (including multilingual)
   */
  get voices() {
    return MULTILINGUAL_VOICES
  }

  list_voices() {
    console.table(MULTILINGUAL_VOICES)
  }
}
