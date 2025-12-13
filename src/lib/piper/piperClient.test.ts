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
