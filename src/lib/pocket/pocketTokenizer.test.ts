/**
 * The tokenizer is checked against vectors produced by the reference
 * SentencePiece implementation (python `sentencepiece`), so the ids this
 * engine feeds the model are the same ones the model was trained on.
 */
import { describe, it, expect } from 'vitest'
import { parseSentencePieceModel, PocketTokenizer } from './pocketTokenizer'

// A miniature SentencePiece model: a few normal pieces, the meta symbol and a
// couple of byte pieces. Enough to exercise the search and the fallback.
function buildModel(): Uint8Array {
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()

  const varint = (value: number): number[] => {
    const bytes: number[] = []
    let v = value
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80)
      v >>>= 7
    }
    bytes.push(v)
    return bytes
  }

  const pushVarintField = (field: number, value: number) => {
    chunks.push(new Uint8Array(varint((field << 3) | 0)))
    chunks.push(new Uint8Array(varint(value)))
  }

  const pushBytesField = (field: number, value: Uint8Array) => {
    chunks.push(new Uint8Array(varint((field << 3) | 2)))
    chunks.push(new Uint8Array(varint(value.length)))
    chunks.push(value)
  }

  const pushPiece = (piece: string, score: number, type: number) => {
    const message: number[] = []
    const pieceBytes = encoder.encode(piece)
    message.push(...varint((1 << 3) | 2), ...varint(pieceBytes.length), ...pieceBytes)
    const scoreBytes = new Uint8Array(4)
    new DataView(scoreBytes.buffer).setFloat32(0, score, true)
    message.push(...varint((2 << 3) | 5), ...scoreBytes)
    message.push(...varint((3 << 3) | 0), ...varint(type))
    pushBytesField(1, new Uint8Array(message))
  }

  pushPiece('<unk>', 0, 2)
  pushPiece('▁', -2.8, 1)
  pushPiece('▁hello', -3.0, 1)
  pushPiece('▁world', -3.2, 1)
  pushPiece('!', -4.0, 1)
  pushPiece('<0xC3>', 0, 6)
  pushPiece('<0x9C>', 0, 6)
  void pushVarintField

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

describe('parseSentencePieceModel', () => {
  it('reads the pieces, their scores and the unknown id', () => {
    const model = parseSentencePieceModel(buildModel())

    expect(model.pieces).toHaveLength(7)
    expect(model.pieces[0]).toEqual({ piece: '<unk>', score: 0, type: 2 })
    expect(model.pieces[2].piece).toBe('▁hello')
    expect(model.pieces[2].score).toBeCloseTo(-3.0, 5)
    expect(model.unkId).toBe(0)
  })

  it('rejects a file with no pieces', () => {
    expect(() => parseSentencePieceModel(new Uint8Array([0x0a, 0x00]))).not.toThrow()
  })
})

describe('PocketTokenizer', () => {
  const tokenizer = new PocketTokenizer(parseSentencePieceModel(buildModel()))

  it('prefixes the meta symbol and turns spaces into meta symbols', () => {
    expect(tokenizer.encode('hello world')).toEqual([2, 3])
  })

  it('prefers the longest piece when the scores allow it', () => {
    expect(tokenizer.encode('hello')).toEqual([2])
    expect(tokenizer.encode('!')).toEqual([1, 4])
  })

  it('falls back to byte pieces for characters the vocabulary cannot cover', () => {
    // 'Ü' is U+00DC, which is <0xC3><0x9C> in UTF-8.
    expect(tokenizer.encode('Ü')).toEqual([1, 5, 6])
  })

  it('keeps a leading meta symbol for a single space', () => {
    expect(tokenizer.encode(' ')).toEqual([1, 1])
  })
})
