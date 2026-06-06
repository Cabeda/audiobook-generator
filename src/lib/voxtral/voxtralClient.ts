/**
 * Voxtral TTS Client — Browser-side integration with TrevorJS WASM+WebGPU.
 *
 * Uses a dedicated Web Worker running the voxtral-mini-realtime-rs WASM package
 * (Q4 GGUF, ~2.67 GB). Model shards are fetched from HuggingFace and cached in
 * IndexedDB. Audio is produced at 24 kHz and returned as a WAV blob.
 *
 * ⚠️ EXPERIMENTAL: Browser inference is ~100x slower than native GPU.
 * Expect ~3-5 minutes per sentence on modern hardware with WebGPU.
 */

import logger from '../utils/logger'

const SAMPLE_RATE = 24000
const HF_BASE = 'https://huggingface.co/TrevorJS/voxtral-tts-q4-gguf/resolve/main'
const SHARD_NAMES = ['shard-aa', 'shard-ab', 'shard-ac', 'shard-ad', 'shard-ae', 'shard-af']
const CACHE_DB_NAME = 'voxtral-tts-cache'
const CACHE_STORE_NAME = 'shards'

export const VOXTRAL_VOICES = [
  'casual_female',
  'casual_male',
  'neutral_female',
  'neutral_male',
  'cheerful_female',
  'fr_female',
  'fr_male',
  'de_female',
  'de_male',
  'es_female',
  'es_male',
  'it_female',
  'it_male',
  'pt_female',
  'pt_male',
  'nl_female',
  'nl_male',
  'hi_female',
  'hi_male',
  'ar_male',
] as const

export type VoxtralVoice = (typeof VOXTRAL_VOICES)[number]

interface VoxtralGenerateParams {
  text: string
  voice?: string
}

// Tokenizer (lazily loaded from tekken.json)
let tokenizer: Map<string, number> | null = null
let tokenizerSpecialTokens: { bos: number; eos: number } | null = null

/**
 * Minimal BPE tokenizer compatible with Tekken (Mistral's tokenizer).
 * Encodes text into token IDs for the Voxtral TTS model.
 */
async function getTokenizer(): Promise<{
  encode: (text: string) => Uint32Array
}> {
  if (tokenizer) {
    return {
      encode: (text: string) => encodeText(text),
    }
  }

  const cached = await getCachedBlob('tekken.json')
  let json: string
  if (cached) {
    json = new TextDecoder().decode(cached)
  } else {
    const resp = await fetch(`${HF_BASE}/tekken.json`)
    if (!resp.ok) throw new Error(`Failed to fetch tokenizer: ${resp.status}`)
    const buf = await resp.arrayBuffer()
    await setCachedBlob('tekken.json', new Uint8Array(buf))
    json = new TextDecoder().decode(buf)
  }

  const data = JSON.parse(json)
  tokenizer = new Map()

  // Tekken format: model.vocab is an array of [token_string, score] pairs
  if (data.model?.vocab) {
    for (let i = 0; i < data.model.vocab.length; i++) {
      const entry = data.model.vocab[i]
      tokenizer.set(entry[0], i)
    }
  }

  // Find special tokens
  const addedTokens: Array<{ id: number; content: string }> = data.added_tokens ?? []
  const bos = addedTokens.find((t) => t.content === '<s>')?.id ?? 1
  const eos = addedTokens.find((t) => t.content === '</s>')?.id ?? 2
  tokenizerSpecialTokens = { bos, eos }

  return { encode: (text: string) => encodeText(text) }
}

function encodeText(text: string): Uint32Array {
  if (!tokenizer || !tokenizerSpecialTokens) throw new Error('Tokenizer not loaded')

  // Simple greedy byte-fallback encoding (sufficient for TTS input)
  const ids: number[] = [tokenizerSpecialTokens.bos]
  let i = 0
  while (i < text.length) {
    let longest = ''
    let longestId = -1
    // Try progressively shorter substrings (greedy longest match)
    for (let end = Math.min(i + 32, text.length); end > i; end--) {
      const substr = text.slice(i, end)
      const id = tokenizer.get(substr)
      if (id !== undefined) {
        longest = substr
        longestId = id
        break
      }
    }
    if (longestId >= 0) {
      ids.push(longestId)
      i += longest.length
    } else {
      // Byte fallback: encode as <0xHH> tokens
      const byte = text.charCodeAt(i)
      const hex = `<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`
      const byteId = tokenizer.get(hex)
      ids.push(byteId ?? 0)
      i++
    }
  }
  ids.push(tokenizerSpecialTokens.eos)
  return new Uint32Array(ids)
}

// --- IndexedDB cache for model shards ---

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(CACHE_STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getCachedBlob(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly')
      const store = tx.objectStore(CACHE_STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

async function setCachedBlob(key: string, data: Uint8Array): Promise<void> {
  try {
    const db = await openCacheDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readwrite')
      const store = tx.objectStore(CACHE_STORE_NAME)
      const req = store.put(data, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Cache write failure is non-fatal
  }
}

// --- Worker management ---

let worker: Worker | null = null
let workerReady = false
let modelLoaded = false
let currentVoice: string | null = null

type WorkerMessage = {
  type: string
  stage?: string
  percent?: number
  message?: string
  samples?: Float32Array
  sampleRate?: number
  voiceName?: string
  mode?: string
}

function postAndWait(msg: Record<string, unknown>, doneTypes: string[]): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('Worker not initialized'))
    const handler = (e: MessageEvent<WorkerMessage>) => {
      if (doneTypes.includes(e.data.type)) {
        worker?.removeEventListener('message', handler)
        resolve(e.data)
      } else if (e.data.type === 'error') {
        worker?.removeEventListener('message', handler)
        reject(new Error(e.data.message ?? 'Worker error'))
      }
    }
    worker.addEventListener('message', handler)
    worker.postMessage(msg)
  })
}

async function ensureWorker(onProgress?: (status: string) => void): Promise<void> {
  if (workerReady && modelLoaded) return

  if (!worker) {
    // The worker script and WASM package are loaded from the voxtral-tts-wasm
    // assets directory that must be placed in the public/ folder during build.
    // For now we use a blob worker that imports from a CDN or local server.
    const workerCode = `
      import init, { VoxtralTts, initWgpuDevice } from './voxtral-tts-wasm/voxtral_mini_realtime.js';
      let tts = null;
      const voiceCache = new Map();
      self.onmessage = async (e) => {
        const { type, ...data } = e.data;
        try {
          switch (type) {
            case 'initTts': {
              self.postMessage({ type: 'progress', stage: 'Initializing WASM...' });
              await init();
              self.postMessage({ type: 'progress', stage: 'Initializing WebGPU device...' });
              await initWgpuDevice();
              tts = new VoxtralTts();
              self.postMessage({ type: 'ready', mode: 'tts' });
              break;
            }
            case 'loadShards': {
              if (!tts) throw new Error('TTS not initialized');
              const shards = data.shards; // Array of Uint8Array
              for (let i = 0; i < shards.length; i++) {
                self.postMessage({ type: 'progress', stage: 'Loading shard ' + (i+1) + '/' + shards.length, percent: Math.round((i/shards.length)*80) });
                tts.appendModelShard(shards[i]);
              }
              self.postMessage({ type: 'progress', stage: 'Loading model into WebGPU...', percent: 85 });
              tts.loadModelFromShards();
              self.postMessage({ type: 'modelLoaded', mode: 'tts' });
              break;
            }
            case 'loadVoice': {
              if (!tts) throw new Error('TTS not initialized');
              const name = data.voiceName;
              if (!voiceCache.has(name)) {
                tts.loadVoice(data.voiceData);
                voiceCache.set(name, true);
              }
              self.postMessage({ type: 'voiceLoaded', voiceName: name });
              break;
            }
            case 'synthesize': {
              if (!tts || !tts.isReady()) throw new Error('TTS model not ready');
              self.postMessage({ type: 'progress', stage: 'Synthesizing speech...' });
              const ids = data.tokenIds instanceof Uint32Array ? data.tokenIds : new Uint32Array(data.tokenIds);
              const samples = await tts.synthesize(ids, data.maxFrames ?? 2000);
              self.postMessage({ type: 'audio', samples, sampleRate: 24000 }, [samples.buffer]);
              break;
            }
            default:
              throw new Error('Unknown message: ' + type);
          }
        } catch (err) {
          self.postMessage({ type: 'error', message: err.message || String(err) });
        }
      };
    `
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    worker = new Worker(URL.createObjectURL(blob), { type: 'module' })
  }

  if (!workerReady) {
    onProgress?.('Initializing Voxtral WASM + WebGPU...')
    await postAndWait({ type: 'initTts' }, ['ready'])
    workerReady = true
  }

  if (!modelLoaded) {
    onProgress?.('Loading model shards (~2.7 GB)...')
    const shards: Uint8Array[] = []
    for (let i = 0; i < SHARD_NAMES.length; i++) {
      const name = SHARD_NAMES[i]
      onProgress?.(`Downloading shard ${i + 1}/${SHARD_NAMES.length}...`)

      let data = await getCachedBlob(`shard-${name}`)
      if (!data) {
        const resp = await fetch(`${HF_BASE}/${name}`)
        if (!resp.ok) throw new Error(`Failed to download shard ${name}: ${resp.status}`)
        data = new Uint8Array(await resp.arrayBuffer())
        await setCachedBlob(`shard-${name}`, data)
      }
      shards.push(data)
    }

    onProgress?.('Loading model into WebGPU...')
    await postAndWait({ type: 'loadShards', shards }, ['modelLoaded'])
    modelLoaded = true
  }
}

async function ensureVoice(voice: string, onProgress?: (status: string) => void): Promise<void> {
  if (currentVoice === voice) return

  onProgress?.(`Loading voice "${voice}"...`)
  let voiceData = await getCachedBlob(`voice-${voice}`)
  if (!voiceData) {
    const resp = await fetch(`${HF_BASE}/voice_embedding/${voice}.safetensors`)
    if (!resp.ok) throw new Error(`Voice "${voice}" not found: ${resp.status}`)
    voiceData = new Uint8Array(await resp.arrayBuffer())
    await setCachedBlob(`voice-${voice}`, voiceData)
  }

  await postAndWait({ type: 'loadVoice', voiceName: voice, voiceData }, ['voiceLoaded'])
  currentVoice = voice
}

function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  // Convert float32 to int16
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

// --- Public API ---

export async function generateVoice(
  params: VoxtralGenerateParams,
  onChunkProgress?: (current: number, total: number) => void,
  onProgress?: (status: string) => void
): Promise<Blob> {
  const voice = (params.voice as VoxtralVoice) || 'casual_female'

  // Initialize model (downloads shards on first use)
  await ensureWorker(onProgress)
  await ensureVoice(voice, onProgress)

  // Tokenize text
  onProgress?.('Tokenizing text...')
  const tok = await getTokenizer()
  const tokenIds = tok.encode(params.text)

  onChunkProgress?.(0, 1)
  onProgress?.('Synthesizing speech (this may take several minutes)...')

  // Synthesize
  const result = await postAndWait({ type: 'synthesize', tokenIds, maxFrames: 2000 }, ['audio'])

  if (!result.samples) throw new Error('No audio returned from synthesis')

  onChunkProgress?.(1, 1)
  logger.info(`[voxtral] Generated ${result.samples.length} samples at ${SAMPLE_RATE}Hz`)

  return float32ToWavBlob(result.samples, SAMPLE_RATE)
}

/**
 * Check if WebGPU is available (required for Voxtral WASM inference).
 */
export function isWebGPUAvailable(): boolean {
  return 'gpu' in navigator
}
