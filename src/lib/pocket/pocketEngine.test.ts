import { describe, it, expect } from 'vitest'
import { numberToWords, normalizeNumbers, prepareText, splitIntoChunks } from './pocketEngine'
import { parseSentencePieceModel, PocketTokenizer } from './pocketTokenizer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tokenizer = new PocketTokenizer(
  parseSentencePieceModel(
    new Uint8Array(readFileSync(resolve(process.cwd(), 'src/lib/pocket/fixtures/tokenizer.model')))
  )
)

describe('numberToWords', () => {
  it('spells numbers out', () => {
    expect(numberToWords(0)).toBe('zero')
    expect(numberToWords(42)).toBe('forty two')
    expect(numberToWords(101)).toBe('one hundred one')
    expect(numberToWords(2026)).toBe('two thousand twenty six')
  })
})

describe('normalizeNumbers', () => {
  it('replaces digits in a sentence', () => {
    expect(normalizeNumbers('in 2026')).toBe('in two thousand twenty six')
  })

  it('reads a grouped number as one number', () => {
    expect(normalizeNumbers('1,000')).toBe('one thousand')
    expect(normalizeNumbers('1,234,567')).toBe(
      'one million two hundred thirty four thousand five hundred sixty seven'
    )
  })

  it('reads a fraction as a whole and a part', () => {
    expect(normalizeNumbers('1.5')).toBe('one point five')
  })
})

describe('prepareText', () => {
  it('gives the model a sentence it can read', () => {
    expect(prepareText('  hello world  ')).toBe('Hello world.')
    expect(prepareText('already done.')).toBe('Already done.')
  })
})

describe('splitIntoChunks', () => {
  it('splits long text into chunks', () => {
    const text = 'One sentence. Two sentence. Three sentence. Four sentence.'
    const chunks = splitIntoChunks(text, tokenizer, 5)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ')).toBe(text)
  })

  it('keeps a short text in one chunk', () => {
    expect(splitIntoChunks('One sentence.', tokenizer, 50)).toEqual(['One sentence.'])
  })
})
