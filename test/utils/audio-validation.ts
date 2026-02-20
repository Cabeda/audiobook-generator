/**
 * Audio Validation Utilities
 *
 * Helpers for validating audio file formats, metadata, and quality
 * Used by test suites to ensure generated audiobooks are valid
 */

export interface WavMetadata {
  sampleRate: number
  channels: number
  bitDepth: number
  duration: number
  dataSize: number
}

/**
 * Create a minimal valid WAV file for testing
 */
export function createTestWav(durationMs: number, sampleRate = 24000): Blob {
  const samples = Math.floor((sampleRate * durationMs) / 1000)
  const dataSize = samples * 2 // 16-bit
  const bufferSize = 44 + dataSize

  const buffer = new ArrayBuffer(bufferSize)
  const view = new DataView(buffer)

  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, bufferSize - 8, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'

  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, dataSize, true)

  // Fill with silence
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, 0, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export interface Mp3Metadata {
  bitrate: number
  sampleRate: number
  duration: number
  hasId3: boolean
  title?: string
  artist?: string
  album?: string
}

export interface M4bChapter {
  title: string
  startTime: number
  endTime: number
}

/**
 * Parse WAV file header and extract metadata
 */
export async function parseWavHeader(blob: Blob): Promise<WavMetadata> {
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)

  // Validate RIFF header
  const riff = String.fromCharCode(...new Uint8Array(buffer, 0, 4))
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header')
  }

  // Validate WAVE format
  const wave = String.fromCharCode(...new Uint8Array(buffer, 8, 4))
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE format')
  }

  // Find fmt chunk
  let offset = 12
  while (offset < buffer.byteLength) {
    const chunkId = String.fromCharCode(...new Uint8Array(buffer, offset, 4))
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      const sampleRate = view.getUint32(offset + 12, true)
      const channels = view.getUint16(offset + 10, true)
      const bitDepth = view.getUint16(offset + 22, true)

      // Find data chunk for duration calculation
      let dataOffset = offset + 8 + chunkSize
      while (dataOffset < buffer.byteLength) {
        const dataChunkId = String.fromCharCode(...new Uint8Array(buffer, dataOffset, 4))
        const dataSize = view.getUint32(dataOffset + 4, true)

        if (dataChunkId === 'data') {
          const bytesPerSample = (bitDepth / 8) * channels
          const duration = dataSize / bytesPerSample / sampleRate

          return {
            sampleRate,
            channels,
            bitDepth,
            duration,
            dataSize,
          }
        }

        dataOffset += 8 + dataSize
      }

      throw new Error('Invalid WAV file: missing data chunk')
    }

    offset += 8 + chunkSize
  }

  throw new Error('Invalid WAV file: missing fmt chunk')
}

/**
 * Parse MP3 file header and extract metadata
 * Note: This is a simplified parser for testing purposes
 */
export async function parseMp3Header(blob: Blob): Promise<Mp3Metadata> {
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)

  // Check for ID3v2 tag
  let hasId3 = false
  let id3Size = 0
  let title: string | undefined
  let artist: string | undefined
  let album: string | undefined

  if (
    buffer.byteLength >= 10 &&
    view.getUint8(0) === 0x49 &&
    view.getUint8(1) === 0x44 &&
    view.getUint8(2) === 0x33
  ) {
    hasId3 = true
    // ID3v2 size is stored in synchsafe integer format
    id3Size =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f)

    // Parse ID3 frames (simplified - only handles TIT2, TPE1, TALB)
    let frameOffset = 10
    while (frameOffset < id3Size + 10 && frameOffset < buffer.byteLength - 10) {
      const frameId = String.fromCharCode(
        view.getUint8(frameOffset),
        view.getUint8(frameOffset + 1),
        view.getUint8(frameOffset + 2),
        view.getUint8(frameOffset + 3)
      )
      const frameSize =
        (view.getUint8(frameOffset + 4) << 24) |
        (view.getUint8(frameOffset + 5) << 16) |
        (view.getUint8(frameOffset + 6) << 8) |
        view.getUint8(frameOffset + 7)

      if (frameSize === 0 || frameSize > buffer.byteLength) break

      if (frameOffset + 11 + frameSize - 1 <= buffer.byteLength) {
        const frameData = new Uint8Array(buffer, frameOffset + 11, frameSize - 1)
        const text = new TextDecoder('utf-8').decode(frameData)

        if (frameId === 'TIT2') title = text
        if (frameId === 'TPE1') artist = text
        if (frameId === 'TALB') album = text
      }

      frameOffset += 10 + frameSize
    }
  }

  // Find first MP3 frame header
  const frameOffset = hasId3 ? id3Size + 10 : 0
  let offset = frameOffset

  while (offset < buffer.byteLength - 4) {
    // Look for frame sync (11 bits set)
    if (view.getUint8(offset) === 0xff && (view.getUint8(offset + 1) & 0xe0) === 0xe0) {
      const header = view.getUint32(offset, false)

      // Extract bitrate index
      const bitrateIndex = (header >> 12) & 0x0f
      const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      const bitrate = bitrateTable[bitrateIndex] || 0

      // Extract sample rate index
      const sampleRateIndex = (header >> 10) & 0x03
      const sampleRateTable = [44100, 48000, 32000]
      const sampleRate = sampleRateTable[sampleRateIndex] || 44100

      // Estimate duration (rough approximation)
      const duration = bitrate > 0 ? (buffer.byteLength * 8) / (bitrate * 1000) : 0

      return {
        bitrate,
        sampleRate,
        duration,
        hasId3,
        title,
        artist,
        album,
      }
    }

    offset++
  }

  throw new Error('Invalid MP3 file: no valid frame header found')
}

/**
 * Parse M4B file and extract chapter markers
 * Note: This requires a full MP4 parser - simplified for testing
 */
export async function parseM4bChapters(blob: Blob): Promise<M4bChapter[]> {
  // This is a placeholder - full implementation would require mp4box.js or similar
  // For now, we'll just validate it's a valid MP4 container
  const buffer = await blob.arrayBuffer()
  const view = new DataView(buffer)

  // Check for ftyp box
  if (buffer.byteLength < 8) {
    throw new Error('Invalid M4B file: too small')
  }

  const _boxSize = view.getUint32(0, false)
  const boxType = String.fromCharCode(
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7)
  )

  if (boxType !== 'ftyp') {
    throw new Error('Invalid M4B file: missing ftyp box')
  }

  // TODO: Implement full chapter parsing using mp4box.js
  // For now, return empty array to indicate valid M4B structure
  return []
}

/**
 * Extract SMIL files from EPUB3 blob
 */
export async function extractSmilFiles(epubBlob: Blob): Promise<string[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(epubBlob)

  const smilFiles: string[] = []

  for (const [filename, file] of Object.entries(zip.files)) {
    if (filename.endsWith('.smil') && !file.dir) {
      const content = await file.async('text')
      smilFiles.push(content)
    }
  }

  return smilFiles
}

/**
 * Calculate checksum of audio blob for comparison
 */
export async function audioChecksum(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate test text with specified word count
 */
export function generateText(wordCount: number): string {
  const words = [
    'the',
    'quick',
    'brown',
    'fox',
    'jumps',
    'over',
    'lazy',
    'dog',
    'and',
    'runs',
    'through',
    'forest',
    'near',
    'river',
    'under',
    'bright',
    'moon',
  ]

  const sentences: string[] = []
  let currentCount = 0

  while (currentCount < wordCount) {
    const sentenceLength = Math.min(10 + Math.floor(Math.random() * 10), wordCount - currentCount)
    const sentence = []

    for (let i = 0; i < sentenceLength; i++) {
      sentence.push(words[Math.floor(Math.random() * words.length)])
    }

    sentences.push(sentence.join(' ') + '.')
    currentCount += sentenceLength
  }

  return sentences.join(' ')
}

/**
 * Validate SMIL XML structure
 */
export function validateSmilStructure(smilContent: string): boolean {
  const parser = new DOMParser()
  const doc = parser.parseFromString(smilContent, 'application/xml')

  // Check for parse errors
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    return false
  }

  // Validate required SMIL elements
  const smil = doc.querySelector('smil')
  const body = doc.querySelector('body')
  const seq = doc.querySelector('seq')

  return !!(smil && body && seq)
}
