/**
 * Audio concatenation utilities for combining chapter audio into a complete audiobook
 */
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

// Singleton FFmpeg instance
let ffmpegInstance: FFmpeg | null = null
let ffmpegLoaded = false

/**
 * Get or create FFmpeg instance
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance
  }

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg()
  }

  if (!ffmpegLoaded) {
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegLoaded = true
  }

  return ffmpegInstance
}

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
  const AudioContextClass =
    globalThis.AudioContext ||
    (globalThis as typeof globalThis & { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext
  const audioContext = new AudioContextClass()
  const sampleRate = audioContext.sampleRate

  onProgress?.({
    current: 0,
    total: chapters.length,
    status: 'loading',
    message: 'Loading audio chapters...',
  })

  // Decode all audio blobs to AudioBuffers
  const audioBuffers: AudioBuffer[] = []
  for (let i = 0; i < chapters.length; i++) {
    onProgress?.({
      current: i + 1,
      total: chapters.length,
      status: 'decoding',
      message: `Decoding chapter ${i + 1}/${chapters.length}: ${chapters[i].title}`,
    })

    // Yield to UI thread to prevent blocking
    await new Promise((resolve) => setTimeout(resolve, 0))

    const arrayBuffer = await chapters[i].blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    audioBuffers.push(audioBuffer)
  }

  onProgress?.({
    current: 0,
    total: 1,
    status: 'concatenating',
    message: 'Concatenating audio chapters...',
  })

  // Calculate total length
  const totalLength = audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const numberOfChannels = audioBuffers[0].numberOfChannels

  // Create output buffer
  const outputBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate)

  // Copy all audio data into output buffer
  let offset = 0
  for (let i = 0; i < audioBuffers.length; i++) {
    const buffer = audioBuffers[i]

    // Yield before processing each chapter to keep UI responsive
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

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
    message: `Encoding to ${format.toUpperCase()}...`,
  })

  // Convert to requested format
  let outputBlob: Blob

  switch (format) {
    case 'mp3':
      outputBlob = await audioBufferToMp3(outputBuffer, bitrate, chapters, options)
      break
    case 'm4b':
      // M4B uses MP3 encoding with .m4b extension and chapter metadata
      outputBlob = await audioBufferToMp3(outputBuffer, bitrate, chapters, options)
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
    message: 'Audiobook created successfully!',
  })

  // Close audio context to free resources
  await audioContext.close()

  return outputBlob
}

/**
 * Convert AudioBuffer to MP3 or M4B blob using FFmpeg
 */
export async function audioBufferToMp3(
  audioBuffer: AudioBuffer,
  bitrate: number,
  chapters: AudioChapter[],
  options: ConcatenationOptions
): Promise<Blob> {
  // First convert AudioBuffer to WAV
  const wavBlob = audioBufferToWav(audioBuffer)

  // Then convert WAV to MP3 or M4B using FFmpeg
  const ffmpeg = await getFFmpeg()

  // Write input WAV file
  const wavData = new Uint8Array(await wavBlob.arrayBuffer())
  await ffmpeg.writeFile('input.wav', wavData)

  // Determine output format and file
  const isM4B = options.format === 'm4b'
  const outputFile = isM4B ? 'output.m4b' : 'output.mp3'
  const codec = isM4B ? 'aac' : 'libmp3lame'

  // Build FFmpeg command
  const args = ['-i', 'input.wav', '-c:a', codec, '-b:a', `${bitrate}k`]

  // Add metadata if available
  if (options.bookTitle) {
    args.push('-metadata', `title=${options.bookTitle}`)
  }
  if (options.bookAuthor) {
    args.push('-metadata', `artist=${options.bookAuthor}`)
  }

  // Add chapter metadata for M4B
  if (isM4B && chapters.length > 0) {
    // Create metadata file for chapters
    const metadata = createFFmpegMetadata(chapters, audioBuffer.duration)
    await ffmpeg.writeFile('metadata.txt', new TextEncoder().encode(metadata))
    args.push('-i', 'metadata.txt', '-map_metadata', '1')
  }

  args.push(outputFile)

  // Execute FFmpeg
  await ffmpeg.exec(args)

  // Read output file
  const data = (await ffmpeg.readFile(outputFile)) as Uint8Array
  const outputBlob = new Blob([new Uint8Array(data)], {
    type: isM4B ? 'audio/m4b' : 'audio/mpeg',
  })

  // Clean up
  await ffmpeg.deleteFile('input.wav')
  await ffmpeg.deleteFile(outputFile)
  if (isM4B && chapters.length > 0) {
    await ffmpeg.deleteFile('metadata.txt')
  }

  return outputBlob
}

/**
 * Create FFmpeg metadata file for chapters
 */
function createFFmpegMetadata(chapters: AudioChapter[], totalDuration: number): string {
  let metadata = ';FFMETADATA1\n'
  let currentTime = 0

  for (let i = 0; i < chapters.length; i++) {
    const duration = chapters[i].duration || totalDuration / chapters.length
    const startMs = Math.floor(currentTime * 1000)
    const endMs = Math.floor((currentTime + duration) * 1000)

    metadata += '\n[CHAPTER]\n'
    metadata += 'TIMEBASE=1/1000\n'
    metadata += `START=${startMs}\n`
    metadata += `END=${endMs}\n`
    metadata += `title=${chapters[i].title}\n`

    currentTime += duration
  }

  return metadata
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
export function createChapterMarkers(
  chapters: AudioChapter[],
  audioBuffers: AudioBuffer[]
): string {
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
 * Convert WAV blob to MP3 blob using FFmpeg
 * @param wavBlob - WAV audio blob
 * @param bitrate - MP3 bitrate (default: 192 kbps)
 * @returns MP3 blob
 */
export async function convertWavToMp3(wavBlob: Blob, bitrate: number = 192): Promise<Blob> {
  const ffmpeg = await getFFmpeg()

  // Write input WAV file
  const wavData = new Uint8Array(await wavBlob.arrayBuffer())
  await ffmpeg.writeFile('input.wav', wavData)

  // Convert to MP3
  await ffmpeg.exec(['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, 'output.mp3'])

  // Read output file
  const data = (await ffmpeg.readFile('output.mp3')) as Uint8Array
  const mp3Blob = new Blob([new Uint8Array(data)], { type: 'audio/mpeg' })

  // Clean up
  await ffmpeg.deleteFile('input.wav')
  await ffmpeg.deleteFile('output.mp3')

  return mp3Blob
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
