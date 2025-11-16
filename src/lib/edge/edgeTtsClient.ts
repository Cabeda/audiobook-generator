/**
 * Edge TTS Client (minimal implementation)
 * A Node-friendly TTS backend implementation suitable for deterministic silent generation.
 * For test environments, the client will generate deterministic mock audio blobs.
 * Integrating with the official `@andresaya/edge-tts` package can be done later.
 */
import { splitTextIntoChunks } from '../kokoro/kokoroClient'
import { concatenateAudioChapters } from '../audioConcat'

export type EdgeVoice = string

export type GenerateParams = {
  text: string
  voice?: EdgeVoice
  speed?: number
  pitch?: number
}

export function listVoices(): EdgeVoice[] {
  // Return a minimal set of known voices. The full list requires integration
  // with the edge-tts provider, which can be added later.
  return ['edge_en-US_AriaNeural', 'edge_en-US_JessaNeural', 'edge_en-GB_LibbyNeural']
}

export function waitForVoices(): Promise<EdgeVoice[]> {
  return Promise.resolve(listVoices())
}

/**
 * Minimal generateVoice implementation: split text into chunks, synthesize each
 * chunk into a small WAV-like Blob, then concatenate using existing helpers.
 */
export async function generateVoice(
  params: GenerateParams,
  onChunkProgress?: (current: number, total: number) => void
): Promise<Blob> {
  const { text } = params
  const chunks = splitTextIntoChunks(text, 200)
  const audioChunks: Blob[] = []

  for (let i = 0; i < chunks.length; i++) {
    if (onChunkProgress) onChunkProgress(i + 1, chunks.length)
    // Synthesize minimal WAV-like blob for test/runtime
    const blob = createSilentWavBlob(120, 24000, 1)
    audioChunks.push(blob)
  }

  if (audioChunks.length === 1) return audioChunks[0]

  const chapters = audioChunks.map((b, i) => ({
    id: `chunk-${i}`,
    title: `Chunk ${i + 1}`,
    blob: b,
  }))
  return await concatenateAudioChapters(chapters, { format: 'wav' })
}

export function listVoicesForUI() {
  return listVoices().map((v) => ({ id: v, name: v }))
}

export default { generateVoice, listVoices, waitForVoices }

/**
 * Create a minimal valid RIFF WAV blob containing silence.
 * This is useful for tests and placeholder TTS to generate valid data
 * which downstream processors (decodeers/ffmpeg) can accept.
 */
function createSilentWavBlob(ms = 120, sampleRate = 24000, channels = 1): Blob {
  const samples = Math.max(1, Math.round((sampleRate * ms) / 1000))
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buffer)
  let offset = 0

  function writeString(str: string) {
    for (let i = 0; i < str.length; i++) dv.setUint8(offset++, str.charCodeAt(i))
  }

  writeString('RIFF')
  dv.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  dv.setUint32(offset, 16, true)
  offset += 4
  dv.setUint16(offset, 1, true) // audio format = PCM
  offset += 2
  dv.setUint16(offset, channels, true)
  offset += 2
  dv.setUint32(offset, sampleRate, true)
  offset += 4
  dv.setUint32(offset, byteRate, true)
  offset += 4
  dv.setUint16(offset, blockAlign, true)
  offset += 2
  dv.setUint16(offset, bytesPerSample * 8, true)
  offset += 2
  writeString('data')
  dv.setUint32(offset, dataSize, true)
  offset += 4

  // Silence = zeros (already zero-initialized), nothing further to write
  return new Blob([buffer], { type: 'audio/wav' })
}
