/**
 * KittenTTS 0.8 engine.
 *
 * The smallest of the lightweight Kitten models (15M parameters, 25 MB int8)
 * runs on onnxruntime-web with no GPU. The graph takes token ids, one style
 * vector and a speed, and returns audio at 24 kHz. Everything else — the
 * phonemes, the style table and the per-voice speed prior — is prepared here
 * from the constants in `kittenText` and `kittenVoices`, which are transcribed
 * from upstream so the model hears what it was trained on.
 *
 * Only the nano int8 checkpoint ships. The other three sizes are separate
 * Hugging Face repos; adding one is a second URL, not a second engine.
 */

import { getOnnxRuntime } from '../onnx/getOnnxRuntime'
import { fetchAndCache } from '../onnx/modelCache'
import { concatFloat32, pcmToWav } from '../wavUtils'
import { splitForKitten, tokenIdsForText } from './kittenText'
import { KITTEN_STYLE_WIDTH, kittenSpeed, resolveKittenVoice, voiceStyle } from './kittenVoices'
import type { TTSEngine, TTSRequest } from '../tts/ttsModels'
import logger from '../utils/logger'

const MODEL_URL =
  'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx'

/** Served from `public/`, cached by the shared model cache after first use. */
const VOICES_URL = '/models/kitten/voices-v0.8.bin'

const SAMPLE_RATE = 24_000

/** Upstream trims the model's fixed-length tail off every chunk. */
const TRAILING_PAD_SAMPLES = 5_000

type Ort = typeof import('onnxruntime-web')
type Session = import('onnxruntime-web').InferenceSession

/** The engine itself; the seam adds its name and capabilities. */
export class KittenEngine implements Omit<TTSEngine, 'id' | 'capabilities'> {
  private ort: Ort | null = null
  private session: Session | null = null
  private voices: Float32Array | null = null
  private loading: Promise<void> | null = null

  async generateVoice(
    request: TTSRequest,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<Blob> {
    await this.load(onProgress)

    const chunks = splitForKitten(request.text ?? '')
    if (chunks.length === 0) throw new Error('KittenTTS: nothing to speak')

    const voiceId = resolveKittenVoice(request.voice)
    const speed = kittenSpeed(voiceId, request.speed)
    const audio: Float32Array[] = []

    for (let index = 0; index < chunks.length; index++) {
      onProgress?.(`KittenTTS: generating chunk ${index + 1}/${chunks.length}`)
      audio.push(await this.synthesize(chunks[index], voiceId, speed))
      onChunkProgress?.(index + 1, chunks.length)
    }

    return pcmToWav(concatFloat32(audio), SAMPLE_RATE)
  }

  /** Load the model and the voice table ahead of time. */
  async warmUp(onProgress?: (status: string) => void): Promise<void> {
    await this.load(onProgress)
  }

  private async synthesize(text: string, voiceId: string, speed: number): Promise<Float32Array> {
    const ort = this.ort!
    const session = this.session!
    const ids = await tokenIdsForText(text)

    const inputs = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map((id) => BigInt(id))), [
        1,
        ids.length,
      ]),
      style: new ort.Tensor('float32', voiceStyle(this.voices!, voiceId, text.length), [
        1,
        KITTEN_STYLE_WIDTH,
      ]),
      speed: new ort.Tensor('float32', Float32Array.of(speed), [1]),
    }

    const result = await session.run(inputs)
    const samples = result[session.outputNames[0]].data as Float32Array

    return samples.length > TRAILING_PAD_SAMPLES
      ? samples.slice(0, samples.length - TRAILING_PAD_SAMPLES)
      : samples
  }

  private async load(onProgress?: (status: string) => void): Promise<void> {
    if (this.session && this.voices) return
    if (this.loading) return this.loading

    this.loading = (async () => {
      onProgress?.('KittenTTS: loading model')

      const [modelBytes, voiceBytes] = await Promise.all([
        fetchAndCache(MODEL_URL).then((res) => res.arrayBuffer()),
        fetchAndCache(VOICES_URL).then((res) => res.arrayBuffer()),
      ])

      this.ort = await getOnnxRuntime()
      this.session = await this.ort.InferenceSession.create(new Uint8Array(modelBytes), {
        executionProviders: [
          'wasm',
        ] as import('onnxruntime-web').InferenceSession.ExecutionProviderConfig[],
        graphOptimizationLevel: 'all',
      })
      this.voices = new Float32Array(voiceBytes)

      logger.info('[KittenTTS] Model ready', { bytes: modelBytes.byteLength })
    })()

    try {
      await this.loading
    } finally {
      this.loading = null
    }
  }
}

let engine: KittenEngine | null = null

/** One engine per tab: it holds the loaded session. */
export function getKittenEngine(): KittenEngine {
  engine ??= new KittenEngine()
  return engine
}
