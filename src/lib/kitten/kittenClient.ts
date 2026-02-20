/**
 * KittenTTS browser client
 * Runs KittenML ONNX models 100% in the browser.
 *
 * Pipeline: text → espeak-ng phonemes → token IDs → ONNX → 24kHz WAV
 */

import logger from '../utils/logger'
import { fetchAndCache } from '../onnx/modelCache'
import { MIN_TEXT_LENGTH } from '../audioConstants'
import { createSilentWav } from '../audioConcat'
import { KITTEN_VOICE_ALIASES, type KittenVoiceId } from './kittenVoices'

export type { KittenVoiceId } from './kittenVoices'
export { listVoices } from './kittenVoices'

export type KittenVariant = 'nano' | 'micro' | 'mini'

const VARIANT_CONFIG: Record<
  KittenVariant,
  { modelUrl: string; voicesUrl: string; sizeMb: number }
> = {
  nano: {
    modelUrl:
      'https://huggingface.co/KittenML/kitten-tts-nano-0.2/resolve/main/kitten_tts_nano_v0_2.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-nano-0.2/resolve/main/voices.npz',
    sizeMb: 24,
  },
  micro: {
    modelUrl:
      'https://huggingface.co/KittenML/kitten-tts-micro-0.8/resolve/main/kitten_tts_micro_v0_8.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-micro-0.8/resolve/main/voices.npz',
    sizeMb: 41,
  },
  mini: {
    modelUrl:
      'https://huggingface.co/KittenML/kitten-tts-mini-0.1/resolve/main/kitten_tts_mini_v0_1.onnx',
    voicesUrl: 'https://huggingface.co/KittenML/kitten-tts-mini-0.1/resolve/main/voices.npz',
    sizeMb: 166,
  },
}

export { VARIANT_CONFIG }

// ── TextCleaner symbol map (ported from Python) ───────────────────────────────

const _pad = '$'
const _punctuation = ';:,.!?¡¿—…\u201c\u00ab\u00bb\u201c\u201d '
const _letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const _ipa =
  'ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\u0329\u02b0ᵻ'

const SYMBOLS = [_pad, ..._punctuation, ..._letters, ..._ipa]
const CHAR_TO_IDX: Record<string, number> = Object.fromEntries(SYMBOLS.map((c, i) => [c, i]))

function textClean(phonemes: string): number[] {
  // Tokenize: split on word chars and punctuation (mirrors Python basic_english_tokenize)
  const tokens = phonemes.match(/\w+|[^\w\s]/gu) ?? []
  const joined = tokens.join(' ')
  const ids: number[] = []
  for (const ch of joined) {
    if (ch in CHAR_TO_IDX) ids.push(CHAR_TO_IDX[ch])
  }
  return ids
}

// ── NPY parser (float32 only) ─────────────────────────────────────────────────

function parseNpy(buffer: ArrayBuffer): { shape: number[]; data: Float32Array } {
  const headerLen = new DataView(buffer).getUint16(8, true)
  const headerStr = new TextDecoder().decode(new Uint8Array(buffer, 10, headerLen))
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/)
  const shape = (shapeMatch?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
  const dataOffset = 10 + headerLen
  return { shape, data: new Float32Array(buffer, dataOffset) }
}

// ── NPZ parser (ZIP of .npy files) ────────────────────────────────────────────

async function parseNpz(
  buffer: ArrayBuffer
): Promise<Record<string, { shape: number[]; data: Float32Array }>> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const arrays: Record<string, { shape: number[]; data: Float32Array }> = {}
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.endsWith('.npy')) {
      const ab = await file.async('arraybuffer')
      arrays[name.replace(/\.npy$/, '')] = parseNpy(ab)
    }
  }
  return arrays
}

// ── Float32 → 16-bit PCM WAV ──────────────────────────────────────────────────

function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  write(36, 'data')
  view.setUint32(40, numSamples * 2, true)
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

// ── Singletons (one cache entry per variant) ──────────────────────────────────

const sessionCache = new Map<KittenVariant, import('onnxruntime-web').InferenceSession>()
const voicesCache = new Map<
  KittenVariant,
  Record<string, { shape: number[]; data: Float32Array }>
>()

async function getSession(
  variant: KittenVariant = 'micro',
  onProgress?: (msg: string) => void
): Promise<import('onnxruntime-web').InferenceSession> {
  if (sessionCache.has(variant)) return sessionCache.get(variant)!
  const { modelUrl, sizeMb } = VARIANT_CONFIG[variant]
  const ort = await import('onnxruntime-web')
  // Point WASM files to CDN matching installed version
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/'
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  onProgress?.(`Downloading KittenTTS ${variant} model (~${sizeMb}MB)...`)
  const res = await fetchAndCache(modelUrl, (loaded, total) => {
    if (total) onProgress?.(`Downloading model: ${((loaded / total) * 100).toFixed(0)}%`)
  })
  const ab = await res.arrayBuffer()
  onProgress?.('Loading model...')
  const session = await ort.InferenceSession.create(new Uint8Array(ab), {
    executionProviders: ['wasm'],
  })
  sessionCache.set(variant, session)
  logger.info(`[KittenTTS] Model loaded (${variant})`)
  return session
}

async function getVoices(variant: KittenVariant = 'micro', onProgress?: (msg: string) => void) {
  if (voicesCache.has(variant)) return voicesCache.get(variant)!
  const { voicesUrl } = VARIANT_CONFIG[variant]
  onProgress?.('Downloading voice embeddings...')
  const res = await fetchAndCache(voicesUrl)
  const ab = await res.arrayBuffer()
  const voices = await parseNpz(ab)
  voicesCache.set(variant, voices)
  logger.info('[KittenTTS] Voices loaded:', Object.keys(voices))
  return voices
}

// ── Text chunking (mirrors Python chunk_text) ─────────────────────────────────

function chunkText(text: string, maxLen = 400): string[] {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const sentence of sentences) {
    const s = sentence.endsWith(',') ? sentence : sentence + ','
    if (s.length <= maxLen) {
      chunks.push(s)
    } else {
      const words = s.split(/\s+/)
      let chunk = ''
      for (const word of words) {
        if (chunk.length + word.length + 1 > maxLen && chunk) {
          chunks.push(chunk.trim() + ',')
          chunk = word
        } else {
          chunk = chunk ? chunk + ' ' + word : word
        }
      }
      if (chunk) chunks.push(chunk.trim() + ',')
    }
  }
  return chunks.length > 0 ? chunks : [text]
}

// ── Main generate function ────────────────────────────────────────────────────

export type GenerateParams = {
  text: string
  voice?: KittenVoiceId
  speed?: number
  variant?: KittenVariant
}

export async function generateVoice(
  params: GenerateParams,
  onChunkProgress?: (current: number, total: number) => void,
  onProgress?: (status: string) => void
): Promise<Blob> {
  const { text, voice = 'Bella', speed = 1.0, variant = 'micro' } = params

  if (text.trim().length < MIN_TEXT_LENGTH) {
    return createSilentWav(0)
  }

  const [session, voices] = await Promise.all([
    getSession(variant, onProgress),
    getVoices(variant, onProgress),
  ])

  const internalVoice = KITTEN_VOICE_ALIASES[voice] ?? KITTEN_VOICE_ALIASES['Bella']
  const voiceArr = voices[internalVoice]
  if (!voiceArr) throw new Error(`Voice '${internalVoice}' not found in voices.npz`)

  const ort = await import('onnxruntime-web')
  const chunks = chunkText(text)
  const audioChunks: Float32Array[] = []

  onProgress?.('Generating speech...')

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    onChunkProgress?.(i + 1, chunks.length)

    // Phonemize
    const { phonemize } = await import('phonemizer')
    const phonemeList = await phonemize(chunk, 'en-us')
    const phonemeStr = phonemeList[0] ?? ''

    // Tokenize
    const ids = textClean(phonemeStr)
    const inputIds = [0, ...ids, 0]

    // Style vector: indexed by text length
    const refId = Math.min(chunk.length, voiceArr.shape[0] - 1)
    const styleDim = voiceArr.shape[1]
    const styleVec = voiceArr.data.slice(refId * styleDim, (refId + 1) * styleDim)

    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [
        1,
        inputIds.length,
      ]),
      style: new ort.Tensor('float32', styleVec, [1, styleDim]),
      speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
    }

    const results = await session.run(feeds)
    const audio = results['waveform'].data as Float32Array
    // Trim trailing silence (last 5000 samples as per Python source)
    audioChunks.push(audio.slice(0, Math.max(0, audio.length - 5000)))
  }

  // Concatenate all chunks
  const totalLen = audioChunks.reduce((s, c) => s + c.length, 0)
  const combined = new Float32Array(totalLen)
  let offset = 0
  for (const chunk of audioChunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  return float32ToWav(combined, 24000)
}
