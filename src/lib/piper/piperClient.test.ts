import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock Piper SDK up front so piperClient picks up the mocked exports
vi.mock('@diffusionstudio/vits-web', () => {
  return {
    stored: vi.fn(),
    download: vi.fn(),
    predict: vi.fn(),
    voices: vi.fn().mockResolvedValue({}),
  }
})

import * as tts from '@diffusionstudio/vits-web'
import { piperClient } from './piperClient'

const ptVoiceId = 'pt_PT-tugão-medium'
// Single-sentence excerpt from docs/expresso_article.html to keep segmentation to one chunk
const articleExcerpt = 'Quem é Ricardo Machado, o novo dono de um bocado disto tudo'
// Multi-sentence excerpt to exercise segmentation and concatenation
const articleFull =
  'Quem é Ricardo Machado, o novo dono de um bocado disto tudo. Começou a conduzir tratores no Cadaval, quis ser padre e arquiteto, mas hoje é dono do Vale Feitoso.'

const makeWav = (bytes = 120) => new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })

// Minimal WAV generator for browser decode checks (16-bit PCM sine wave)
const makePlayableWav = (durationMs = 500, sampleRate = 16000): Blob => {
  const totalSamples = Math.floor((durationMs / 1000) * sampleRate)
  const headerSize = 44
  const dataSize = totalSamples * 2 // 16-bit mono
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)
  // RIFF header
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + dataSize, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'
  // fmt chunk
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  // data chunk
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, dataSize, true)

  // Write sine wave samples
  const amplitude = 0.2 * 0x7fff
  const freq = 440
  let offset = headerSize
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate
    const sample = Math.sin(2 * Math.PI * freq * t)
    view.setInt16(offset, Math.floor(sample * amplitude), true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

const mockStored = vi.mocked(tts.stored)
const mockDownload = vi.mocked(tts.download)
const mockPredict = vi.mocked(tts.predict)

describe('piperClient.generate (pt-PT)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockStored.mockResolvedValue([ptVoiceId] as unknown as Awaited<ReturnType<typeof tts.stored>>)
    mockDownload.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof tts.download>>)
  })

  it('produces audio for a Portuguese article excerpt', async () => {
    mockPredict.mockResolvedValue(makeWav())

    const blob = await piperClient.generate(articleExcerpt, { voiceId: ptVoiceId })

    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBeGreaterThan(0)
  })

  it('concatenates multiple segments for the full article excerpt', async () => {
    mockPredict.mockResolvedValue(makeWav())

    const blob = await piperClient.generate(articleFull, { voiceId: ptVoiceId })

    expect(mockPredict.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('throws when Piper returns empty audio for the excerpt', async () => {
    mockPredict.mockResolvedValue(new Blob([], { type: 'audio/wav' }))

    await expect(piperClient.generate(articleExcerpt, { voiceId: ptVoiceId })).rejects.toThrow(
      /No audio generated/
    )
  })
})

// Browser-only decode test to catch streaming/format regressions end-to-end
// Diagnostic: extract and validate real HTML text parsing
const realArticleHtml = `
<article class="post-content" data-id="123">
  <div class="metadata">
    <span class="author">John Author</span>
    <time class="publish-date">2024-01-15</time>
  </div>
  <h1>The Future of AI</h1>
  <p>Artificial intelligence is transforming the world at an unprecedented pace. From healthcare to finance, AI is revolutionizing how we work and live.</p>
  <ul>
    <li>Machine learning enables pattern recognition at scale</li>
    <li>Deep learning powers computer vision and natural language processing</li>
  </ul>
  <img src="test.jpg" alt="AI illustration" />
  <p>The impact of AI will only grow as technology advances.</p>
</article>
`

describe('diagnostic: HTML text extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockStored.mockResolvedValue([ptVoiceId] as unknown as Awaited<ReturnType<typeof tts.stored>>)
    mockDownload.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof tts.download>>)
  })

  it('extracts meaningful text from metadata-heavy HTML', () => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(realArticleHtml, 'text/html')
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)

    const textNodes: string[] = []
    let node = walker.nextNode()
    while (node) {
      const text = node.textContent?.trim()
      if (text && text.length > 0) {
        textNodes.push(text)
      }
      node = walker.nextNode()
    }

    expect(textNodes.length).toBeGreaterThan(0)
    expect(textNodes.some((t) => t.includes('AI'))).toBe(true)
    expect(textNodes.some((t) => t.includes('learning'))).toBe(true)
  })

  it('generates audio from extracted text using Piper (mocked)', async () => {
    // Simulate extracting text from the complex HTML
    const parser = new DOMParser()
    const doc = parser.parseFromString(realArticleHtml, 'text/html')
    const textContent = doc.body.textContent || ''

    // This is what would be fed to Piper
    expect(textContent.length).toBeGreaterThan(0)

    // Mock Piper to return playable audio
    mockPredict.mockResolvedValue(makePlayableWav())

    // Call generate with the extracted text
    const blob = await piperClient.generate(textContent, { voiceId: ptVoiceId })

    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBeGreaterThan(0)
    expect(mockPredict).toHaveBeenCalled()
  })

  it('handles Piper returning undefined or invalid data', async () => {
    mockPredict.mockResolvedValue(undefined as unknown as Blob)

    await expect(piperClient.generate('This should fail', { voiceId: ptVoiceId })).rejects.toThrow()
  })

  it('handles Piper throwing an error with metadata-heavy article', async () => {
    // Always fail - to test that all retries are exhausted and error is properly caught
    mockPredict.mockRejectedValue(new Error('Piper model unavailable'))

    await expect(piperClient.generate('Test article.', { voiceId: ptVoiceId })).rejects.toThrow()

    // Predict should be called multiple times due to retry logic
    expect(mockPredict.mock.calls.length).toBeGreaterThan(1)
  })

  it('logs what text segments are being sent to Piper', async () => {
    mockPredict.mockResolvedValue(makePlayableWav())

    const text = 'First sentence. Second sentence. Third sentence.'
    await piperClient.generate(text, { voiceId: ptVoiceId })

    // Verify that predict was called with the text (or chunks of it)
    expect(mockPredict).toHaveBeenCalled()

    // Check what was actually sent to predict
    const callArgs = mockPredict.mock.calls.map((call) => call[0]?.text)
    expect(callArgs).not.toContain('')
    expect(callArgs).not.toContain(null)
    expect(callArgs).not.toContain(undefined)

    // At least one call should contain readable text
    const hasValidText = callArgs.some(
      (arg) => arg && typeof arg === 'string' && arg.trim().length > 0
    )
    expect(hasValidText).toBe(true)
  })
})

const hasAudioContext = typeof window !== 'undefined' && 'AudioContext' in window

describe.skipIf(!hasAudioContext)('piperClient.generate (browser decode)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockStored.mockResolvedValue([ptVoiceId] as unknown as Awaited<ReturnType<typeof tts.stored>>)
    mockDownload.mockResolvedValue(undefined as unknown as Awaited<ReturnType<typeof tts.download>>)
  })

  it('produces decodable audio for a Portuguese article excerpt', async () => {
    const playable = makePlayableWav()
    mockPredict.mockResolvedValue(playable)

    const blob = await piperClient.generate(articleExcerpt, { voiceId: ptVoiceId })

    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))

    expect(decoded.duration).toBeGreaterThan(0)
    expect(decoded.numberOfChannels).toBe(1)
    ctx.close()
  })
})
