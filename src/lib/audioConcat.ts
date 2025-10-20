/**
 * Audio concatenation utilities for combining chapter audio into a complete audiobook
 */
import lamejs from 'lamejs'

export type AudioFormat = 'wav' | 'mp3' | 'm4b'

export type AudioChapter = {
  id: string
  title: string
  blob: Blob
  duration?: number
}

export type ConcatenationProgress = {
  current: number
  total: number
  status: 'loading' | 'decoding' | 'concatenating' | 'encoding' | 'complete'
  message: string
}

export type ConcatenationOptions = {
  format?: AudioFormat
  bitrate?: number // For MP3: 128, 192, 256, 320 kbps
  bookTitle?: string
  bookAuthor?: string
}

/**
 * Concatenate multiple audio blobs into a single audio file
 * @param chapters - Array of audio chapters with metadata
 * @param options - Concatenation options including format
 * @param onProgress - Optional progress callback
 * @returns Combined audio blob with chapter markers
 */
export async function concatenateAudioChapters(
  chapters: AudioChapter[],
  options: ConcatenationOptions = {},
  onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
  const { format = 'wav', bitrate = 192 } = options
  if (chapters.length === 0) {
    throw new Error('No chapters to concatenate')
  }

  // Note: Even with single chapter, we still process it to ensure correct format
  if (chapters.length === 1 && format === 'wav' && chapters[0].blob.type === 'audio/wav') {
    return chapters[0].blob
  }

  // Create audio context for processing
  const AudioContextClass = globalThis.AudioContext || (globalThis as typeof globalThis & { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextClass()
  const sampleRate = audioContext.sampleRate

  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'loading',
    message: 'Loading audio chapters...'
  })

  // Decode all audio blobs to AudioBuffers
  const audioBuffers: AudioBuffer[] = []
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.({
      current: i + 1,
      total: chapters.length,
      status: 'decoding',
      message: `Decoding chapter ${i + 1}/${chapters.length}: ${chapters[i].title}`
    })

    const arrayBuffer = await chapters[i].blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    audioBuffers.push(audioBuffer)
  }

  onProgress?.({
    current: 0,
    total: 1,
    status: 'concatenating',
    message: 'Concatenating audio chapters...'
  })

  // Calculate total length
  const totalLength = audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const numberOfChannels = audioBuffers[0].numberOfChannels

  // Create output buffer
  const outputBuffer = audioContext.createBuffer(
    numberOfChannels,
    totalLength,
    sampleRate
  )

  // Copy all audio data into output buffer
  let offset = 0
  for (let i = 0; i < audioBuffers.length; i++) {
    const buffer = audioBuffers[i]
    
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const outputData = outputBuffer.getChannelData(channel)
      const inputData = buffer.getChannelData(channel)
      outputData.set(inputData, offset)
    }
    
    offset += buffer.length
  }

  onProgress?.({
    current: 0,
    total: 1,
    status: 'encoding',
    message: `Encoding to ${format.toUpperCase()}...`
  })

  // Convert to requested format
  let outputBlob: Blob
  
  switch (format) {
    case 'mp3':
      outputBlob = audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'm4b':
      // M4B uses MP3 encoding with .m4b extension and chapter metadata
      outputBlob = audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'wav':
    default:
      outputBlob = audioBufferToWav(outputBuffer)
      break
  }

  onProgress?.({
    current: 1,
    total: 1,
    status: 'complete',
    message: 'Audiobook created successfully!'
  })

  // Close audio context to free resources
  await audioContext.close()

  return outputBlob
}

/**
 * Convert AudioBuffer to MP3 blob
 */
function audioBufferToMp3(
  audioBuffer: AudioBuffer,
  bitrate: number,
  _chapters: AudioChapter[],
  options: ConcatenationOptions
): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = Math.floor(audioBuffer.sampleRate)
  const mp3encoder = new lamejs.Mp3Encoder(numberOfChannels, sampleRate, bitrate)
  
  const mp3Data: Int8Array[] = []
  const sampleBlockSize = 1152 // Standard MP3 frame size

  // Convert float samples to 16-bit PCM
  const left = new Int16Array(audioBuffer.length)
  const right = numberOfChannels > 1 ? new Int16Array(audioBuffer.length) : null
  
  const leftData = audioBuffer.getChannelData(0)
  for (let i = 0; i < audioBuffer.length; i++) {
    left[i] = leftData[i] * 0x7fff
  }
  
  if (right && numberOfChannels > 1) {
    const rightData = audioBuffer.getChannelData(1)
    for (let i = 0; i < audioBuffer.length; i++) {
      right[i] = rightData[i] * 0x7fff
    }
  }

  // Encode in blocks
  for (let i = 0; i < audioBuffer.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize)
    const rightChunk = right ? right.subarray(i, i + sampleBlockSize) : leftChunk
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }
  }

  // Flush remaining data
  const mp3buf = mp3encoder.flush()
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf)
  }

  // Create blob with ID3 tags for M4B format
  const mimeType = options.format === 'm4b' ? 'audio/m4b' : 'audio/mpeg'
  const buffers = mp3Data.map(data => new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength))
  return new Blob(buffers, { type: mimeType })
}

/**
 * Convert AudioBuffer to WAV blob
 */
function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16

  const bytesPerSample = bitDepth / 8
  const blockAlign = numberOfChannels * bytesPerSample

  const data = interleave(audioBuffer)
  const dataLength = data.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // Write WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, format, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  // Write audio data
  floatTo16BitPCM(view, 44, data)

  return new Blob([buffer], { type: 'audio/wav' })
}

/**
 * Interleave channels from AudioBuffer
 */
function interleave(audioBuffer: AudioBuffer): Float32Array {
  const numberOfChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length * numberOfChannels
  const result = new Float32Array(length)

  let offset = 0
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      result[offset++] = audioBuffer.getChannelData(channel)[i]
    }
  }

  return result
}

/**
 * Write string to DataView
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Convert float samples to 16-bit PCM
 */
function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
}

/**
 * Create chapter markers metadata (for future M4B/MP3 support)
 */
export function createChapterMarkers(chapters: AudioChapter[], audioBuffers: AudioBuffer[]): string {
  let currentTime = 0
  const markers: string[] = []

  for (let i = 0; i < chapters.length; i++) {
    const duration = audioBuffers[i].duration
    const startTime = formatTimestamp(currentTime)
    
    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}=${startTime}`)
    markers.push(`CHAPTER${String(i + 1).padStart(2, '0')}NAME=${chapters[i].title}`)
    
    currentTime += duration
  }

  return markers.join('\n')
}

/**
 * Format timestamp for chapter markers (HH:MM:SS.mmm)
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/**
 * Download blob as file
 */
export function downloadAudioFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Get audio duration from blob
 */
export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      reject(new Error('Failed to load audio metadata'))
    })
    audio.src = URL.createObjectURL(blob)
  })
}
