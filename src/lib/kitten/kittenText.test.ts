import { describe, it, expect } from 'vitest'
import { tokenIdsForPhonemes, splitForKitten } from './kittenText'
import { KITTEN_SYMBOLS, symbolId } from './kittenSymbols'

/**
 * Expected ids come from running upstream's TextCleaner over the same phoneme
 * strings: map every character, drop the unknown ones, then frame with 0 / 10 / 0.
 */
describe('kittenSymbols', () => {
  it('has the upstream table size and boundaries', () => {
    expect(KITTEN_SYMBOLS.length).toBe(178)
    expect(symbolId('$')).toBe(0)
    expect(symbolId(' ')).toBe(16)
    expect(symbolId('A')).toBe(17)
    expect(symbolId('ɑ')).toBe(69)
  })

  it('has no token for characters the model was not trained on', () => {
    expect(symbolId('\u0000')).toBeUndefined()
    expect(symbolId('漢')).toBeUndefined()
  })
})

describe('tokenIdsForPhonemes', () => {
  it('frames a word with pad and end tokens', () => {
    expect(tokenIdsForPhonemes('hɛˈloʊ')).toEqual([0, 50, 86, 156, 54, 57, 135, 10, 0])
  })

  it('keeps punctuation separated by the space upstream inserts between tokens', () => {
    expect(tokenIdsForPhonemes('hɛˌloʊ, wɜːld!')).toEqual([
      0, 50, 86, 157, 54, 57, 135, 16, 3, 16, 65, 87, 158, 54, 46, 16, 5, 10, 0,
    ])
  })

  it('returns just the frame for empty input', () => {
    expect(tokenIdsForPhonemes('')).toEqual([0, 10, 0])
  })

  it('drops characters outside the table instead of substituting them', () => {
    expect(tokenIdsForPhonemes('h\u0000x')).toEqual([0, 50, 16, 16, 66, 10, 0])
  })
})

describe('splitForKitten', () => {
  it('leaves text that fits in one chunk alone', () => {
    expect(splitForKitten('A short sentence.')).toEqual(['A short sentence.'])
  })

  it('splits at sentence boundaries before the 400 character limit', () => {
    const sentence = 'This is a sentence of about fifty characters long. '
    const text = sentence.repeat(20)
    const chunks = splitForKitten(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(400)
      expect(chunk.length).toBeGreaterThan(0)
    }
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim())
  })

  it('word-splits a single sentence that is longer than the limit', () => {
    const chunks = splitForKitten('word '.repeat(200).trim())

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400)
  })

  it('ends every chunk with punctuation', () => {
    const chunks = splitForKitten('word '.repeat(200).trim())

    for (const chunk of chunks) expect(chunk).toMatch(/[.!?…]$/)
  })

  it('returns nothing for blank text', () => {
    expect(splitForKitten('   \n  ')).toEqual([])
  })
})
