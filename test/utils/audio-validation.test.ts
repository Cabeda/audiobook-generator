import { describe, it, expect } from 'vitest'
import {
  parseWavHeader,
  parseMp3Header,
  generateText,
  audioChecksum,
  validateSmilStructure,
  createTestWav,
} from './audio-validation'

describe('Audio Validation Utilities', () => {
  describe('createTestWav', () => {
    it('should create valid WAV with specified duration', () => {
      const wav = createTestWav(1000) // 1 second
      expect(wav.type).toBe('audio/wav')
      expect(wav.size).toBeGreaterThan(44) // Header + data
    })

    it('should create WAV with custom sample rate', () => {
      const wav = createTestWav(500, 16000)
      expect(wav.size).toBeGreaterThan(44)
    })
  })

  describe('parseWavHeader', () => {
    it('should parse valid WAV file', async () => {
      const wav = createTestWav(1000, 24000)
      const metadata = await parseWavHeader(wav)

      expect(metadata.sampleRate).toBe(24000)
      expect(metadata.channels).toBe(1)
      expect(metadata.bitDepth).toBe(16)
      expect(metadata.duration).toBeCloseTo(1.0, 1)
      expect(metadata.dataSize).toBeGreaterThan(0)
    })

    it('should parse WAV with different sample rate', async () => {
      const wav = createTestWav(2000, 16000)
      const metadata = await parseWavHeader(wav)

      expect(metadata.sampleRate).toBe(16000)
      expect(metadata.duration).toBeCloseTo(2.0, 1)
    })

    it('should throw on invalid WAV - missing RIFF', async () => {
      const invalid = new Blob(['not a wav file'])
      await expect(parseWavHeader(invalid)).rejects.toThrow('Invalid WAV file: missing RIFF header')
    })

    it('should throw on invalid WAV - missing WAVE', async () => {
      const buffer = new ArrayBuffer(12)
      const view = new DataView(buffer)
      view.setUint32(0, 0x52494646, false) // 'RIFF'
      view.setUint32(4, 4, true)
      view.setUint32(8, 0x12345678, false) // Not 'WAVE'

      const invalid = new Blob([buffer])
      await expect(parseWavHeader(invalid)).rejects.toThrow('Invalid WAV file: missing WAVE format')
    })
  })

  describe('parseMp3Header', () => {
    it('should throw on invalid MP3', async () => {
      const invalid = new Blob(['not an mp3'])
      await expect(parseMp3Header(invalid)).rejects.toThrow('Invalid MP3 file')
    })

    it('should detect MP3 without ID3 tags', async () => {
      // Create minimal MP3 frame header
      const buffer = new ArrayBuffer(100)
      const view = new DataView(buffer)

      // MP3 frame sync + header
      view.setUint8(0, 0xff)
      view.setUint8(1, 0xfb) // MPEG1 Layer 3
      view.setUint8(2, 0x90) // 128 kbps, 44.1kHz
      view.setUint8(3, 0x00)

      const mp3 = new Blob([buffer])
      const metadata = await parseMp3Header(mp3)

      expect(metadata.hasId3).toBe(false)
      expect(metadata.bitrate).toBeGreaterThan(0)
      expect(metadata.sampleRate).toBeGreaterThan(0)
    })
  })

  describe('generateText', () => {
    it('should generate text with exact word count', () => {
      const text = generateText(100)
      const words = text.trim().split(/\s+/)
      expect(words.length).toBe(100)
    })

    it('should generate text with 1 word', () => {
      const text = generateText(1)
      const words = text.trim().split(/\s+/)
      expect(words.length).toBe(1)
    })

    it('should generate text with 1000 words', () => {
      const text = generateText(1000)
      const words = text.trim().split(/\s+/)
      expect(words.length).toBe(1000)
    })

    it('should generate different text on each call', () => {
      const text1 = generateText(50)
      const text2 = generateText(50)
      // Should be different due to randomness
      expect(text1).not.toBe(text2)
    })
  })

  describe('audioChecksum', () => {
    it('should generate consistent checksum for same data', async () => {
      const wav = createTestWav(100)
      const checksum1 = await audioChecksum(wav)
      const checksum2 = await audioChecksum(wav)

      expect(checksum1).toBe(checksum2)
      expect(checksum1).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
    })

    it('should generate different checksums for different data', async () => {
      const wav1 = createTestWav(100)
      const wav2 = createTestWav(200)

      const checksum1 = await audioChecksum(wav1)
      const checksum2 = await audioChecksum(wav2)

      expect(checksum1).not.toBe(checksum2)
    })
  })

  describe('validateSmilStructure', () => {
    it('should validate correct SMIL structure', () => {
      const validSmil = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0">
  <body>
    <seq id="seq1">
      <par id="par1">
        <text src="chapter1.xhtml#p1"/>
        <audio src="audio/chapter1.mp3" clipBegin="0s" clipEnd="5s"/>
      </par>
    </seq>
  </body>
</smil>`

      expect(validateSmilStructure(validSmil)).toBe(true)
    })

    it('should reject invalid XML', () => {
      const invalidXml = '<smil><body><seq></body></smil>' // Mismatched tags
      expect(validateSmilStructure(invalidXml)).toBe(false)
    })

    it('should reject SMIL without required elements', () => {
      const noBody = '<?xml version="1.0"?><smil></smil>'
      expect(validateSmilStructure(noBody)).toBe(false)
    })
  })
})
