/**
 * Pocket TTS engine.
 *
 * An ONNX export of Kyutai's Pocket TTS (18.2M parameters, English) runs
 * entirely in the browser on onnxruntime-web. The engine keeps the recurrent
 * caches of the flow LM and the Mimi decoder, samples one latent frame at a
 * time and decodes the frames to 24 kHz audio.
 *
 * The model's own configuration — dimensions, sampling temperature, the end of
 * speech rule — comes from the bundle manifest that ships with the weights, so
 * the engine does not hard-code anything about the model.
 */

import { getOnnxRuntime } from '../onnx/getOnnxRuntime'
import { fetchAndCache } from '../onnx/modelCache'
import { buildWavHeader, floatTo16BitPCM, WAV_HEADER_BYTES } from '../wavUtils'
import { parseSentencePieceModel, PocketTokenizer } from './pocketTokenizer'
import {
  parseBundle,
  parseVoicesBin,
  pocketModelUrls,
  readVoiceTensor,
  type PocketBundle,
  type PocketStateSpec,
  type PocketVoiceBundle,
} from './pocketAssets'
import type { TTSEngine, TTSRequest } from '../tts/ttsModels'
import logger from '../utils/logger'

/** Frames decoded per decoder call. */
const DECODE_BLOCK_FRAMES = 4

/** The flow cache grows in steps of this many frames. */
const FLOW_CACHE_GRANULARITY = 64

/** Fade the first few milliseconds of audio in, so the decoder does not click. */
const DECODER_FADE_IN_SECONDS = 0.005

/** Target number of tokens per generated chunk. */
const CHUNK_TARGET_TOKENS = 50

type Ort = typeof import('onnxruntime-web')
type Session = import('onnxruntime-web').InferenceSession
type Tensor = import('onnxruntime-web').Tensor

export class PocketEngine implements TTSEngine {
  private ort: Ort | null = null
  private bundle: PocketBundle | null = null
  private tokenizer: PocketTokenizer | null = null
  private sessions: {
    textConditioner: Session
    flowLmMain: Session
    flowLmFlow: Session
    mimiDecoder: Session
  } | null = null
  private voices: Record<string, PocketVoiceBundle> = {}
  /** The whole voice bundle, loaded when a single voice cannot be fetched. */
  private allVoices: Record<string, PocketVoiceBundle> | null = null
  private loading: Promise<void> | null = null

  async generateVoice(
    request: TTSRequest,
    onChunkProgress?: (current: number, total: number) => void,
    onProgress?: (status: string) => void
  ): Promise<Blob> {
    await this.load(onProgress)
    const bundle = this.bundle!
    const ort = this.ort!
    const tokenizer = this.tokenizer!

    const text = prepareText(request.text)
    if (!text) throw new Error('Pocket TTS: nothing to speak')

    const chunks = splitIntoChunks(text, tokenizer)
    if (chunks.length === 0) throw new Error('Pocket TTS: nothing to speak')

    const voiceName =
      request.voice && request.voice in (bundle.voices ?? {}) ? request.voice : 'alba'
    const voice = await this.loadVoice(voiceName, onProgress)

    const tokenIds = chunks.map((chunk) => tokenizer.encode(chunk))
    const capacity = flowCacheCapacity(bundle, voiceFrames(voice), tokenIds)

    const audioChunks: Float32Array[] = []

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const ids = tokenIds[chunkIndex]
      onProgress?.(`Pocket TTS: generating chunk ${chunkIndex + 1}/${chunks.length}`)

      const flowState = this.flowStateFromVoice(voice, capacity)
      const decoderState = this.decoderState()
      const emptySequence = new ort.Tensor('float32', new Float32Array(0), [
        1,
        0,
        bundle.dims.latent,
      ])
      const emptyText = new ort.Tensor('float32', new Float32Array(0), [
        1,
        0,
        bundle.dims.text_embedding,
      ])

      // Condition the flow LM on the text.
      const textTensor = new ort.Tensor('int64', BigInt64Array.from(ids.map((id) => BigInt(id))), [
        1,
        ids.length,
      ])
      const conditioned = await this.sessions!.textConditioner.run({ token_ids: textTensor })
      let textEmbeddings = conditioned[this.sessions!.textConditioner.outputNames[0]]
      if (textEmbeddings.dims.length === 2) {
        textEmbeddings = new ort.Tensor('float32', textEmbeddings.data as Float32Array, [
          1,
          textEmbeddings.dims[0],
          textEmbeddings.dims[1],
        ])
      }

      const prefill = await this.sessions!.flowLmMain.run({
        sequence: emptySequence,
        text_embeddings: textEmbeddings,
        ...flowState,
      })
      replaceNamedStateOutputs(bundle.flowStates, flowState, prefill)

      // Sample latents one frame at a time.
      const latents: Float32Array[] = []
      let decodedCount = 0
      let current = new ort.Tensor('float32', new Float32Array(bundle.dims.latent).fill(NaN), [
        1,
        1,
        bundle.dims.latent,
      ])
      const maxFrames = maxGenerationFrames(bundle, ids.length)
      const extraFrames = framesAfterEos(bundle, chunks[chunkIndex])
      let eosStep: number | null = null

      for (let step = 0; step < maxFrames; step++) {
        const result = await this.sessions!.flowLmMain.run({
          sequence: current,
          text_embeddings: emptyText,
          ...flowState,
        })

        const eosLogit = (await readTensorData(result.eos_logit))[0]
        if (eosStep === null && step >= bundle.eos.min_frames && eosLogit > bundle.eos.threshold) {
          eosStep = step
        }
        if (eosStep !== null && step >= eosStep + extraFrames) break

        const latent = await this.sampleLatent(result.conditioning)
        latents.push(latent)
        current = new ort.Tensor('float32', latent, [1, 1, bundle.dims.latent])
        replaceNamedStateOutputs(bundle.flowStates, flowState, result)

        if (latents.length - decodedCount >= DECODE_BLOCK_FRAMES) {
          const block = latents.slice(decodedCount, decodedCount + DECODE_BLOCK_FRAMES)
          audioChunks.push(await this.decodeFrames(bundle, block, decoderState))
          decodedCount += block.length
          onChunkProgress?.(chunkIndex + 1, chunks.length)
        }
      }

      if (latents.length > decodedCount) {
        audioChunks.push(await this.decodeFrames(bundle, latents.slice(decodedCount), decoderState))
      }
    }

    return pcmToWav(concatFloat32(audioChunks), bundle.sample_rate)
  }

  // ── model loading ─────────────────────────────────────────────────────────

  /** Load the model and its voices ahead of time. */
  async warmUp(onProgress?: (status: string) => void): Promise<void> {
    await this.load(onProgress)
  }

  private async load(onProgress?: (status: string) => void): Promise<void> {
    if (this.sessions) return
    if (this.loading) return this.loading

    this.loading = (async () => {
      const urls = pocketModelUrls()
      onProgress?.('Pocket TTS: loading model')

      const [bundleText, tokenizerBytes] = await Promise.all([
        fetchAndCache(urls.bundle).then((res) => res.text()),
        fetchAndCache(urls.tokenizer).then((res) => res.arrayBuffer()),
      ])

      this.bundle = parseBundle(JSON.parse(bundleText))
      this.tokenizer = new PocketTokenizer(parseSentencePieceModel(new Uint8Array(tokenizerBytes)))

      this.ort = await getOnnxRuntime()
      const ort = this.ort

      const sessionOptions = {
        executionProviders: [
          'wasm',
        ] as import('onnxruntime-web').InferenceSession.ExecutionProviderConfig[],
        graphOptimizationLevel: 'all' as const,
      }

      const loadSession = async (url: string) => {
        onProgress?.(`Pocket TTS: loading ${url.split('/').pop()}`)
        const bytes = await fetchAndCache(url).then((res) => res.arrayBuffer())
        return ort.InferenceSession.create(new Uint8Array(bytes), sessionOptions)
      }

      const [textConditioner, flowLmMain, flowLmFlow, mimiDecoder] = await Promise.all([
        loadSession(urls.text_conditioner),
        loadSession(urls.flow_lm_main),
        loadSession(urls.flow_lm_flow),
        loadSession(urls.mimi_decoder),
      ])

      this.sessions = { textConditioner, flowLmMain, flowLmFlow, mimiDecoder }
      logger.info('[PocketTTS] Model ready', { model: this.bundle.model })
    })()

    try {
      await this.loading
    } finally {
      this.loading = null
    }
  }

  private async loadVoice(
    name: string,
    onProgress?: (status: string) => void
  ): Promise<PocketVoiceBundle> {
    if (this.voices[name]) return this.voices[name]

    // The voice bundle is 34 MB and holds all eight voices. Fetching it whole
    // once is what makes voices work offline: a Range slice cannot be stored in
    // the Cache API, and HuggingFace answers the redirect with the full body
    // anyway, so the slice saved nothing.
    if (!this.allVoices) {
      onProgress?.('Pocket TTS: loading voices')
      this.allVoices = parseVoicesBin(
        await fetchAndCache(pocketModelUrls().voices).then((r) => r.arrayBuffer())
      )
    }
    const voice = this.allVoices[name]
    if (!voice) throw new Error(`Pocket TTS: voice ${name} is not in the model`)
    this.voices[name] = voice
    return voice
  }

  // ── generation helpers ────────────────────────────────────────────────────

  private flowStateFromVoice(voice: PocketVoiceBundle, capacity: number): Record<string, Tensor> {
    const ort = this.ort!
    const state: Record<string, Tensor> = {}

    for (const spec of this.bundle!.flowStates) {
      const record = voice.tensors[spec.name]
      if (!record) {
        throw new Error(`Pocket TTS: voice state is missing ${spec.name}`)
      }
      const data = readVoiceTensor(voice, record)
      const axis = dynamicAxis(spec)
      if (axis < 0) {
        state[spec.name] = new ort.Tensor(spec.dtype as any, data as any, record.shape)
        continue
      }
      const padded = padAlongAxis(data as Float32Array, record.shape, axis, capacity)
      state[spec.name] = new ort.Tensor(spec.dtype as any, padded.data as any, padded.shape)
    }

    return state
  }

  private decoderState(): Record<string, Tensor> {
    const ort = this.ort!
    const state: Record<string, Tensor> = {}
    for (const spec of this.bundle!.decoderStates) {
      const size = spec.shape.reduce((a, b) => a * b, 1)
      if (spec.dtype === 'int64') {
        state[spec.name] = new ort.Tensor('int64', new BigInt64Array(size), spec.shape)
      } else {
        state[spec.name] = new ort.Tensor('float32', new Float32Array(size), spec.shape)
      }
    }
    return state
  }

  private async sampleLatent(conditioning: Tensor): Promise<Float32Array> {
    const ort = this.ort!
    const bundle = this.bundle!
    const dim = bundle.dims.latent
    const noise = gaussianNoise(dim, Math.sqrt(bundle.temperature))
    const x = new ort.Tensor('float32', noise, [1, dim])
    const result = await this.sessions!.flowLmFlow.run({ c: conditioning, x })
    return new Float32Array(await readTensorData(result.latent))
  }

  private async decodeFrames(
    bundle: PocketBundle,
    latents: Float32Array[],
    decoderState: Record<string, Tensor>
  ): Promise<Float32Array> {
    const ort = this.ort!
    const dim = bundle.dims.latent

    const data = new Float32Array(latents.length * dim)
    latents.forEach((latent, index) => data.set(latent, index * dim))

    const result = await this.sessions!.mimiDecoder.run({
      latent: new ort.Tensor('float32', data, [1, latents.length, dim]),
      ...decoderState,
    })
    replaceNamedStateOutputs(bundle.decoderStates, decoderState, result)

    const audio = new Float32Array(await readTensorData(result.audio))
    const fade = Math.min(audio.length, Math.floor(bundle.sample_rate * DECODER_FADE_IN_SECONDS))
    for (let i = 0; i < fade; i++) {
      audio[i] *= fade === 1 ? 1 : i / (fade - 1)
    }
    return audio
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function dynamicAxis(spec: PocketStateSpec): number {
  const axes = Object.keys(spec.dynamic ?? {})
  return axes.length === 1 ? Number(axes[0]) : -1
}

/**
 * Copy a compact state tensor into a zeroed tensor whose dynamic axis has
 * `capacity` entries. Unwritten cache slots must be zeros, not NaN.
 */
function padAlongAxis(
  source: Float32Array,
  sourceShape: number[],
  axis: number,
  capacity: number
): { data: Float32Array; shape: number[] } {
  const targetShape = sourceShape.slice()
  targetShape[axis] = capacity
  if (sourceShape[axis] > capacity) {
    throw new Error(
      `Pocket TTS: voice state has ${sourceShape[axis]} frames, but the cache only holds ${capacity}`
    )
  }

  const outer = sourceShape.slice(0, axis).reduce((a, b) => a * b, 1)
  const inner = sourceShape.slice(axis + 1).reduce((a, b) => a * b, 1)
  const sourceRow = sourceShape[axis] * inner
  const targetRow = capacity * inner
  const target = new Float32Array(outer * targetRow)

  for (let i = 0; i < outer; i++) {
    target.set(source.subarray(i * sourceRow, (i + 1) * sourceRow), i * targetRow)
  }
  return { data: target, shape: targetShape }
}

/** Frames the voice prompt occupies in the flow cache. */
function voiceFrames(voice: PocketVoiceBundle): number {
  const record = voice.tensors.state_offset
  if (!record) throw new Error('Pocket TTS: voice state is missing state_offset')
  return Number(readVoiceTensor(voice, record)[0])
}

/** Upstream's generation budget: tokens / 3 per second plus 2 s, in frames. */
function maxGenerationFrames(bundle: PocketBundle, tokenCount: number): number {
  const { tokens_per_second, padding_seconds } = bundle.max_gen
  return Math.ceil((tokenCount / tokens_per_second + padding_seconds) * bundle.frame_rate)
}

/** Frames kept after the first end of speech: very short prompts get a longer tail. */
function framesAfterEos(bundle: PocketBundle, text: string): number {
  const rule = bundle.eos.frames_after_eos
  const words = text.split(/\s+/).filter(Boolean).length
  return words <= rule.max_short_words ? rule.short : rule.long
}

/**
 * Flow-cache length for an utterance: the voice prompt, the longest chunk's
 * text and its whole generation budget, rounded up.
 */
function flowCacheCapacity(
  bundle: PocketBundle,
  voiceFrameCount: number,
  chunkTokenCounts: number[][]
): number {
  const textAndFrames = Math.max(
    ...chunkTokenCounts.map((tokens) => tokens.length + maxGenerationFrames(bundle, tokens.length))
  )
  const needed = voiceFrameCount + textAndFrames
  if (!Number.isSafeInteger(needed) || needed <= 0) {
    throw new Error('Pocket TTS: invalid flow cache length')
  }
  return Math.ceil(needed / FLOW_CACHE_GRANULARITY) * FLOW_CACHE_GRANULARITY
}

function gaussianNoise(size: number, std: number): Float32Array {
  const data = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    let u = 0
    let v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    data[i] = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std
  }
  return data
}

async function readTensorData(tensor: Tensor): Promise<ArrayLike<number>> {
  if (tensor.location === 'cpu' || tensor.location === 'cpu-pinned') {
    return tensor.data as ArrayLike<number>
  }
  return (await tensor.getData()) as ArrayLike<number>
}

/** Feed the state outputs of a run back into the state for the next run. */
function replaceNamedStateOutputs(
  specs: PocketStateSpec[],
  state: Record<string, Tensor>,
  result: Record<string, Tensor>
): void {
  for (const spec of specs) {
    const tensor = result[spec.output]
    if (tensor) state[spec.name] = tensor
  }
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Wrap float samples in a 16-bit PCM WAV blob. */
function pcmToWav(samples: Float32Array, sampleRate: number): Blob {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataLength)
  const view = new DataView(buffer)
  new Uint8Array(buffer).set(
    new Uint8Array(
      buildWavHeader(
        {
          audioFormat: 1,
          numChannels: 1,
          sampleRate,
          byteRate: sampleRate * 2,
          blockAlign: 2,
          bitsPerSample: 16,
        },
        dataLength
      )
    )
  )
  floatTo16BitPCM(view, WAV_HEADER_BYTES, samples)
  return new Blob([buffer], { type: 'audio/wav' })
}

// ─── text preparation ────────────────────────────────────────────────────────

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** Spell a number out, the way the model was trained to read it. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value < 0) return `minus ${numberToWords(-value)}`
  if (value === 0) return 'zero'
  if (value < 20) return ONES[value]
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]
    const ones = value % 10
    return ones ? `${tens} ${ONES[ones]}` : tens
  }
  if (value < 1000) {
    const hundreds = `${ONES[Math.floor(value / 100)]} hundred`
    const rest = value % 100
    return rest ? `${hundreds} ${numberToWords(rest)}` : hundreds
  }
  if (value < 1_000_000) {
    const thousands = `${numberToWords(Math.floor(value / 1000))} thousand`
    const rest = value % 1000
    return rest ? `${thousands} ${numberToWords(rest)}` : thousands
  }
  const millions = `${numberToWords(Math.floor(value / 1_000_000))} million`
  const rest = value % 1_000_000
  return rest ? `${millions} ${numberToWords(rest)}` : millions
}

/**
 * Replace digits with words, so the model reads them instead of the digits.
 *
 * A comma groups thousands ("1,000" is one thousand) and a point separates
 * the fraction ("1.5" is one point five).
 */
export function normalizeNumbers(text: string): string {
  return text.replace(/\d[\d,]*(?:\.\d+)?/g, (match) => {
    const [wholePart, fractionPart] = match.split('.')
    const whole = Number(wholePart.replace(/,/g, ''))
    if (!Number.isFinite(whole)) return match

    let out = numberToWords(whole)
    if (fractionPart !== undefined) {
      const decimals = fractionPart
        .split('')
        .map((digit) => ONES[Number(digit)])
        .join(' ')
      out = `${out} point ${decimals}`
    }
    return out
  })
}

/**
 * Prepare text for the model: the model reads words, not digits, and it wants
 * a sentence that starts with a capital and ends with a full stop.
 */
export function prepareText(text: string): string {
  let out = text.trim()
  if (!out) return ''

  out = out.replace(/\s+/g, ' ')
  out = normalizeNumbers(out)

  if (/[a-zA-Z0-9]$/.test(out)) out += '.'
  if (out[0] && !/[A-Z]/.test(out[0])) {
    out = out[0].toUpperCase() + out.slice(1)
  }
  return out
}

/** Split text into chunks of at most a target number of tokens. */
export function splitIntoChunks(
  text: string,
  tokenizer: PocketTokenizer,
  targetTokens = CHUNK_TARGET_TOKENS
): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  let currentTokens = 0

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    const tokens = tokenizer.encode(trimmed).length
    if (current && currentTokens + tokens > targetTokens) {
      chunks.push(current)
      current = trimmed
      currentTokens = tokens
    } else {
      current = current ? `${current} ${trimmed}` : trimmed
      currentTokens += tokens
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * The Pocket TTS engine.
 *
 * One instance for the app: the model and its sessions are expensive to build,
 * so the engine is shared and can be warmed up before the first request.
 */
let engine: PocketEngine | null = null

export function getPocketEngine(): PocketEngine {
  if (!engine) engine = new PocketEngine()
  return engine
}
