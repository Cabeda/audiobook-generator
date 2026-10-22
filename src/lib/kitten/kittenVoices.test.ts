import { describe, it, expect } from 'vitest'
import {
  KITTEN_BUNDLE_ORDER,
  KITTEN_STYLE_ROWS,
  KITTEN_STYLE_WIDTH,
  KITTEN_VOICE_IDS,
  KITTEN_VOICES,
  kittenSpeed,
  resolveKittenVoice,
  styleRowIndex,
  voiceStyle,
} from './kittenVoices'

describe('KITTEN_VOICES', () => {
  it('lists the eight upstream voices, in upstream order', () => {
    expect(KITTEN_VOICES).toEqual([
      'Bella',
      'Jasper',
      'Luna',
      'Bruno',
      'Rosie',
      'Hugo',
      'Kiki',
      'Leo',
    ])
  })

  it('maps every voice to a style row bundle', () => {
    for (const voice of KITTEN_VOICES) {
      expect(KITTEN_VOICE_IDS[voice]).toMatch(/^expr-voice-[2345]-[fm]$/)
    }
    expect(KITTEN_VOICE_IDS.Bella).toBe('expr-voice-2-f')
    expect(KITTEN_VOICE_IDS.Leo).toBe('expr-voice-5-m')
  })
})

describe('resolveKittenVoice', () => {
  it('keeps a known display name', () => {
    expect(resolveKittenVoice('Luna')).toBe('expr-voice-3-f')
  })

  it('falls back to the first voice for an unknown or missing name', () => {
    expect(resolveKittenVoice('alba')).toBe('expr-voice-2-f')
    expect(resolveKittenVoice(undefined)).toBe('expr-voice-2-f')
  })
})

describe('kittenSpeed', () => {
  it('applies the per-voice speed prior upstream calibrates', () => {
    // Leo's prior is 0.8, so the default 1.0 becomes 0.8.
    expect(kittenSpeed('expr-voice-5-m', 1)).toBeCloseTo(0.8)
    expect(kittenSpeed('expr-voice-2-f', 1)).toBeCloseTo(0.8)
    expect(kittenSpeed('expr-voice-4-f', 1)).toBeCloseTo(0.8)
  })

  it('scales the requested speed', () => {
    expect(kittenSpeed('expr-voice-5-m', 1.5)).toBeCloseTo(1.2)
  })

  it('defaults to normal speed', () => {
    expect(kittenSpeed('expr-voice-5-m', undefined)).toBeCloseTo(0.8)
  })
})

describe('styleRowIndex', () => {
  it('selects the row for the chunk length', () => {
    expect(styleRowIndex(0)).toBe(0)
    expect(styleRowIndex(42)).toBe(42)
    expect(styleRowIndex(KITTEN_STYLE_ROWS - 1)).toBe(KITTEN_STYLE_ROWS - 1)
  })

  it('clamps long chunks to the last row', () => {
    expect(styleRowIndex(KITTEN_STYLE_ROWS)).toBe(KITTEN_STYLE_ROWS - 1)
    expect(styleRowIndex(5000)).toBe(KITTEN_STYLE_ROWS - 1)
  })
})

describe('voiceStyle', () => {
  /** Eight voices of 400 rows of 256 floats, each row filled with its slot number. */
  const bundle = new Float32Array(
    KITTEN_BUNDLE_ORDER.length * KITTEN_STYLE_ROWS * KITTEN_STYLE_WIDTH
  )
  for (let slot = 0; slot < bundle.length / KITTEN_STYLE_WIDTH; slot++) {
    bundle.fill(slot, slot * KITTEN_STYLE_WIDTH, (slot + 1) * KITTEN_STYLE_WIDTH)
  }

  it('picks the row for the voice and the chunk length', () => {
    const style = voiceStyle(bundle, 'expr-voice-2-m', 7)
    expect(style.length).toBe(KITTEN_STYLE_WIDTH)
    expect(style[0]).toBe(KITTEN_STYLE_ROWS + 7)
  })

  it('clamps to the last row of the table', () => {
    expect(voiceStyle(bundle, 'expr-voice-2-f', 5000)[0]).toBe(KITTEN_STYLE_ROWS - 1)
  })

  it('reads the last voice at the end of the bundle', () => {
    expect(voiceStyle(bundle, 'expr-voice-5-m', 0)[0]).toBe(7 * KITTEN_STYLE_ROWS)
  })

  it('falls back to the first voice for an id it does not ship', () => {
    expect(voiceStyle(bundle, 'expr-voice-9-x', 0)[0]).toBe(0)
  })
})
