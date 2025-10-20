// Lightweight in-browser TTS runner for demos.
// This generates a synthetic waveform (naive) and returns a WAV Blob.

export interface GenerationProgress {
  chapterId: string
  index: number
  totalChunks: number
}

export function synthesizeTextToWav(text: string, opts?: { sampleRate?: number }): Promise<Blob> {
  const sampleRate = opts?.sampleRate || 22050
  // Very naive synthesis: duration proportional to text length
  const durationSeconds = Math.min(12, Math.max(1, Math.floor(text.length / 40)))
  const totalSamples = durationSeconds * sampleRate

  const samples = new Float32Array(totalSamples)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    samples[i] = 0.12 * Math.sin(2 * Math.PI * (220 + 60 * Math.sin(0.5 * t)) * t)
  }

  const arrayBuffer = encodeWAV(samples, sampleRate)
  return Promise.resolve(new Blob([arrayBuffer], { type: 'audio/wav' }))
}

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return buffer
}

// Convert a Float32Array (PCM -1..1) to a WAV Blob
export function float32ArrayToWavBlob(samples: Float32Array, sampleRate: number = 22050): Blob {
  const arrayBuffer = encodeWAV(samples, sampleRate)
  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

// Combine multiple WAV blobs into a single WAV Blob using OfflineAudioContext
export async function combineAudioBlobs(blobs: Blob[], sampleRate: number = 22050): Promise<Blob> {
  // Decode all blobs to AudioBuffer
  type AudioCtxCtor = new (
    numChannels: number,
    length: number,
    sampleRate: number
  ) => OfflineAudioContext
  const audioCtxCtor =
    (
      globalThis as unknown as {
        OfflineAudioContext?: AudioCtxCtor
        webkitOfflineAudioContext?: AudioCtxCtor
      }
    ).OfflineAudioContext ||
    (
      globalThis as unknown as {
        OfflineAudioContext?: AudioCtxCtor
        webkitOfflineAudioContext?: AudioCtxCtor
      }
    ).webkitOfflineAudioContext
  if (!audioCtxCtor) throw new Error('OfflineAudioContext is not available in this environment')
  const audioCtx = new audioCtxCtor(1, 1, sampleRate)
  const decoded: AudioBuffer[] = []
  for (const b of blobs) {
    const array = await b.arrayBuffer()
    const decodedBuf = await audioCtx.decodeAudioData(array)
    decoded.push(decodedBuf)
  }

  const totalLength = decoded.reduce((s, b) => s + b.length, 0)
  const outCtxCtor =
    (
      globalThis as unknown as {
        OfflineAudioContext?: AudioCtxCtor
        webkitOfflineAudioContext?: AudioCtxCtor
      }
    ).OfflineAudioContext ||
    (
      globalThis as unknown as {
        OfflineAudioContext?: AudioCtxCtor
        webkitOfflineAudioContext?: AudioCtxCtor
      }
    ).webkitOfflineAudioContext
  if (!outCtxCtor) throw new Error('OfflineAudioContext is not available in this environment')
  const outCtx = new outCtxCtor(1, totalLength, sampleRate)
  const outBuffer = outCtx.createBuffer(1, totalLength, sampleRate)
  let offset = 0
  for (const b of decoded) {
    const data = b.getChannelData(0)
    outBuffer.getChannelData(0).set(data, offset)
    offset += b.length
  }

  // Render the buffer into PCM via OfflineAudioContext
  const source = outCtx.createBufferSource()
  source.buffer = outBuffer
  source.connect(outCtx.destination)
  source.start()
  const rendered = await outCtx.startRendering()
  // Extract Float32Array
  const finalData = rendered.getChannelData(0)
  const wavArray = encodeWAV(finalData, sampleRate)
  return new Blob([wavArray], { type: 'audio/wav' })
}
// Removed stray end patch marker
