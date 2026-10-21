/**
 * Pocket TTS model assets.
 *
 * The engine is an ONNX export of Kyutai's Pocket TTS "english_18m_refl_2026-10"
 * model: 18.2M parameters, reward fine-tuned, with eight preset voices.
 *
 * The weights are Kyutai's, released under CC-BY-4.0. This module only reads
 * them; it does not modify or redistribute them.
 */

/** Where the model files live. Pinned so a cached file never mixes two exports. */
export const POCKET_MODEL_REPO = 'maxime/pocket-tts-18m-onnx'
export const POCKET_MODEL_REVISION = '9b874ef8e0be4a95a352a0fe0455e064e75404e0'
export const POCKET_MODEL_NAME = 'english_18m_refl_2026-10'
export const POCKET_MODEL_BASE = `https://huggingface.co/${POCKET_MODEL_REPO}/resolve/${POCKET_MODEL_REVISION}/${POCKET_MODEL_NAME}`

/** The preset voices the model ships with. */
export const POCKET_VOICE_IDS = [
  'alba',
  'azelma',
  'cosette',
  'eponine',
  'fantine',
  'javert',
  'jean',
  'marius',
] as const

export type PocketVoiceId = (typeof POCKET_VOICE_IDS)[number]

export const POCKET_VOICE_LABELS: Record<PocketVoiceId, string> = {
  alba: 'Alba (Female)',
  azelma: 'Azelma (Female)',
  cosette: 'Cosette (Female)',
  eponine: 'Eponine (Female)',
  fantine: 'Fantine (Female)',
  javert: 'Javert (Male)',
  jean: 'Jean (Male)',
  marius: 'Marius (Male)',
}

export function pocketModelUrls(base: string = POCKET_MODEL_BASE) {
  return {
    text_conditioner: `${base}/text_conditioner.onnx`,
    flow_lm_main: `${base}/flow_lm_main_int8.onnx`,
    flow_lm_flow: `${base}/flow_lm_flow.onnx`,
    mimi_decoder: `${base}/mimi_decoder.onnx`,
    tokenizer: `${base}/tokenizer.model`,
    bundle: `${base}/bundle.json`,
    voices: `${base}/voices.bin`,
  }
}

// ─── bundle.json ─────────────────────────────────────────────────────────────

export interface PocketStateSpec {
  name: string
  output: string
  shape: number[]
  dtype: string
  dynamic: Record<string, string>
}

export interface PocketBundle {
  model: string
  sample_rate: number
  frame_rate: number
  frame_size: number
  dims: {
    latent: number
    conditioning: number
    text_embedding: number
    kv_heads: number
    head_dim: number
    layers: number
  }
  flow: { type: 'drifting' | 'lsd'; decode_steps: number }
  temperature: number
  eos: {
    threshold: number
    min_frames: number
    frames_after_eos: { max_short_words: number; short: number; long: number }
  }
  max_gen: { tokens_per_second: number; padding_seconds: number }
  insert_bos_before_voice: boolean
  flowStates: PocketStateSpec[]
  decoderStates: PocketStateSpec[]
  voices: Record<string, { start: number; end: number }>
  predefined_voices: string[]
}

/** Parse and validate the bundle manifest. */
export function parseBundle(manifest: unknown): PocketBundle {
  const data = manifest as Record<string, any>
  const flowGraph = data?.graphs?.flow_lm_main
  const decoderGraph = data?.graphs?.mimi_decoder

  if (!Array.isArray(flowGraph?.states) || !Array.isArray(decoderGraph?.states) || !data?.dims) {
    throw new Error('bundle.json is missing graph state descriptions')
  }

  const flowType = data.flow?.type
  if (flowType !== 'drifting' && flowType !== 'lsd') {
    throw new Error(`Unsupported flow head in bundle.json: ${flowType}`)
  }

  const voices: Record<string, { start: number; end: number }> = {}
  for (const [name, range] of Object.entries(data.voices ?? {})) {
    const { start, end } = range as { start?: number; end?: number }
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end! > start!) {
      voices[name] = { start: start!, end: end! }
    }
  }

  return {
    model: data.model,
    sample_rate: data.sample_rate,
    frame_rate: data.frame_rate,
    frame_size: data.frame_size,
    dims: data.dims,
    flow: data.flow,
    temperature: data.temperature,
    eos: data.eos,
    max_gen: data.max_gen,
    insert_bos_before_voice: data.insert_bos_before_voice,
    flowStates: flowGraph.states,
    decoderStates: decoderGraph.states,
    voices,
    predefined_voices: data.predefined_voices ?? [],
  }
}

// ─── voices.bin (PTVB1) ──────────────────────────────────────────────────────

export interface PocketTensorRecord {
  dtype: 'float32' | 'int64'
  shape: number[]
  dataOffset: number
  byteLength: number
}

export interface PocketVoiceBundle {
  name: string
  buffer: ArrayBuffer
  tensors: Record<string, PocketTensorRecord>
}

const PTVB_MAGIC = 'PTVB1'

/** Parse the whole voice bundle. */
export function parseVoicesBin(buffer: ArrayBuffer): Record<string, PocketVoiceBundle> {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)))
  if (magic !== PTVB_MAGIC) {
    throw new Error('voices.bin is not a PTVB1 voice bundle')
  }
  return parsePtvbVoices(buffer, 5)
}

function parsePtvbVoices(buffer: ArrayBuffer, start: number): Record<string, PocketVoiceBundle> {
  const voices: Record<string, PocketVoiceBundle> = {}
  const view = new DataView(buffer)
  const voiceCount = view.getUint32(start, true)

  let offset = start + 4
  for (let voiceIdx = 0; voiceIdx < voiceCount; voiceIdx++) {
    const read = readVoice(buffer, offset)
    voices[read.voice.name] = read.voice
    offset = read.nextOffset
  }

  return voices
}

/** Read one voice (its name and its tensors) from a PTVB1 buffer. */
function readVoice(
  buffer: ArrayBuffer,
  start: number
): { voice: PocketVoiceBundle; nextOffset: number } {
  const view = new DataView(buffer)
  const decoder = new TextDecoder()
  let offset = start

  const readUint16 = () => {
    const value = view.getUint16(offset, true)
    offset += 2
    return value
  }
  const readUint32 = () => {
    const value = view.getUint32(offset, true)
    offset += 4
    return value
  }
  const readString = (length: number) => {
    const value = decoder.decode(new Uint8Array(buffer, offset, length))
    offset += length
    return value
  }

  const name = readString(readUint16())
  const tensorCount = readUint16()
  const tensors: Record<string, PocketTensorRecord> = {}

  for (let tensorIdx = 0; tensorIdx < tensorCount; tensorIdx++) {
    const path = readString(readUint16())
    const dtypeCode = view.getUint8(offset++)
    const rank = view.getUint8(offset++)
    const shape: number[] = []
    for (let i = 0; i < rank; i++) shape.push(readUint32())
    const byteLength = readUint32()
    tensors[path] = {
      dtype:
        dtypeCode === 0 ? 'float32' : dtypeCode === 1 ? 'int64' : (`unknown:${dtypeCode}` as any),
      shape,
      dataOffset: offset,
      byteLength,
    }
    offset += byteLength
  }

  return { voice: { name, buffer, tensors }, nextOffset: offset }
}

/** Read a tensor's data out of a voice bundle. */
export function readVoiceTensor(
  voice: PocketVoiceBundle,
  record: PocketTensorRecord
): Float32Array | BigInt64Array {
  const bytes = new Uint8Array(voice.buffer, record.dataOffset, record.byteLength)
  if (record.dtype === 'float32') {
    const data = new Float32Array(record.byteLength / 4)
    new Uint8Array(data.buffer).set(bytes)
    return data
  }
  const data = new BigInt64Array(record.byteLength / 8)
  new Uint8Array(data.buffer).set(bytes)
  return data
}
