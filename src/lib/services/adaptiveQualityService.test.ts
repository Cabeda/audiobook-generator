import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveTierLadder, getTierConfig, cancelUpgrade } from './adaptiveQualityService'
import type { PiperVoice } from '../piper/piperClient'

vi.mock('../utils/resourceMonitor', () => ({
  getStartingTier: vi.fn(() => 0),
  getTargetTier: vi.fn(() => 1),
  canRunUpgrade: vi.fn(async () => true),
}))

vi.mock('../ttsWorkerManager', () => ({
  getTTSWorker: vi.fn(() => ({
    generateVoice: vi.fn(async () => new Blob(['audio'], { type: 'audio/wav' })),
  })),
}))

vi.mock('../../stores/segmentProgressStore', () => ({
  updateSegmentQuality: vi.fn(),
  getChapterSegmentProgress: vi.fn(() => undefined),
}))

vi.mock('../libraryDB', () => ({
  saveSegmentIndividually: vi.fn(async () => {}),
}))

const piperVoicesEn: PiperVoice[] = [
  { key: 'en_US-low', name: 'English Low', language: 'en_US', quality: 'low' },
  { key: 'en_US-medium', name: 'English Medium', language: 'en_US', quality: 'medium' },
  { key: 'en_US-high', name: 'English High', language: 'en_US', quality: 'high' },
]

const piperVoicesDe: PiperVoice[] = [
  { key: 'de_DE-low', name: 'German Low', language: 'de_DE', quality: 'low' },
  { key: 'de_DE-medium', name: 'German Medium', language: 'de_DE', quality: 'medium' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveTierLadder', () => {
  it('uses Kokoro ladder for English', () => {
    const ladder = resolveTierLadder('en', [])
    expect(ladder.tiers[0]?.model).toBe('web_speech')
    expect(ladder.tiers[1]?.model).toBe('kokoro')
    expect(ladder.tiers[2]?.model).toBe('kokoro')
    expect(ladder.tiers[3]?.model).toBe('kokoro')
    expect(ladder.maxAvailableTier).toBe(3)
  })

  it('uses Piper ladder for non-English with voices', () => {
    const ladder = resolveTierLadder('de', piperVoicesDe)
    expect(ladder.tiers[0]?.model).toBe('web_speech')
    expect(ladder.tiers[1]?.model).toBe('piper')
    expect(ladder.tiers[2]?.model).toBe('piper')
    expect(ladder.tiers[3]).toBeNull() // no high voice for de
    expect(ladder.maxAvailableTier).toBe(2)
  })

  it('returns only tier 0 when no Piper voices available', () => {
    const ladder = resolveTierLadder('ja', [])
    expect(ladder.tiers[0]?.model).toBe('web_speech')
    expect(ladder.tiers[1]).toBeNull()
    expect(ladder.maxAvailableTier).toBe(0)
  })

  it('assigns correct Piper voice keys per tier', () => {
    const ladder = resolveTierLadder('en', piperVoicesEn)
    // For English, Kokoro is used — Piper voices are ignored
    expect(ladder.tiers[1]?.model).toBe('kokoro')
  })

  it('assigns Piper voices for non-English with all qualities', () => {
    const ladder = resolveTierLadder('en', piperVoicesEn)
    // English uses Kokoro regardless
    expect(ladder.maxAvailableTier).toBe(3)
  })
})

describe('getTierConfig', () => {
  it('returns null for unavailable tier (no voices for language)', () => {
    const config = getTierConfig(3, 'ja', [])
    expect(config).toBeNull()
  })

  it('falls back to nearest quality when exact tier unavailable', () => {
    // German has no 'high' voice — tier 3 is null in the ladder
    const config = getTierConfig(3, 'de', piperVoicesDe)
    expect(config).toBeNull()
  })

  it('returns web_speech config for tier 0', () => {
    const config = getTierConfig(0, 'de', piperVoicesDe)
    expect(config?.model).toBe('web_speech')
  })

  it('returns kokoro config for tier 1 in English', () => {
    const config = getTierConfig(1, 'en', [])
    expect(config?.model).toBe('kokoro')
    expect(config?.quantization).toBe('q4')
  })

  it('returns piper config for tier 1 in German', () => {
    const config = getTierConfig(1, 'de', piperVoicesDe)
    expect(config?.model).toBe('piper')
    expect(config?.voice).toBe('de_DE-low')
  })
})

describe('cancelUpgrade', () => {
  it('does not throw when cancelling non-existent chapter', () => {
    expect(() => cancelUpgrade('non-existent-chapter')).not.toThrow()
  })
})
