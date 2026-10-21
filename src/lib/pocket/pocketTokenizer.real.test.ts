/**
 * The tokenizer is checked against vectors produced by the reference
 * SentencePiece implementation (python `sentencepiece`), so the ids this
 * engine feeds the model are the same ones the model was trained on.
 *
 * The fixture is the `tokenizer.model` of Kyutai's Pocket TTS English model
 * (CC-BY-4.0), used here only as a test input.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSentencePieceModel, PocketTokenizer } from './pocketTokenizer'
import vectors from './fixtures/tokenizer-vectors.json'

const fixture = readFileSync(resolve(process.cwd(), 'src/lib/pocket/fixtures/tokenizer.model'))
const tokenizer = new PocketTokenizer(parseSentencePieceModel(new Uint8Array(fixture)))

describe('PocketTokenizer', () => {
  it('matches the reference SentencePiece implementation', () => {
    for (const [text, expected] of Object.entries(vectors)) {
      expect(tokenizer.encode(text), `text: ${text}`).toEqual(expected.ids)
    }
  })

  it('reads the model as a 4000 piece unigram vocabulary', () => {
    const model = parseSentencePieceModel(new Uint8Array(fixture))
    expect(model.pieces).toHaveLength(4000)
    expect(model.unkId).toBe(0)
  })
})
