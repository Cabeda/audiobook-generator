/**
 * SentencePiece tokenizer for the Pocket TTS models.
 *
 * The models ship a `tokenizer.model` file: a SentencePiece model protobuf
 * holding a unigram vocabulary. This module reads that protobuf and encodes
 * text with it, so no separate tokenizer runtime is needed in the browser.
 *
 * The model is a unigram model with an "identity" normalizer: the text is
 * prefixed with the meta symbol and every space becomes the meta symbol. The
 * best segmentation is then found with a Viterbi search over the vocabulary.
 * Characters the vocabulary cannot cover fall back to their byte pieces.
 */

/** The meta symbol SentencePiece uses in place of a word boundary. */
const META = '▁'

/** Score penalty for a byte-fallback piece, so the byte path never wins over a real segmentation. */
const BYTE_FALLBACK_PENALTY = -1e6

/** SentencePiece piece types. */
const TYPE_NORMAL = 1
const TYPE_UNKNOWN = 2
const TYPE_BYTE = 6

export interface SentencePiece {
  piece: string
  score: number
  type: number
}

export interface SentencePieceModel {
  pieces: SentencePiece[]
  unkId: number
}

// ─── protobuf reader ─────────────────────────────────────────────────────────

interface Field {
  number: number
  wireType: number
  value: number | Uint8Array
}

/** Read the fields of a protobuf message. Only the wire types we need. */
function readFields(bytes: Uint8Array): Field[] {
  const fields: Field[] = []
  let offset = 0

  const readVarint = (): number => {
    let result = 0
    let shift = 0
    while (offset < bytes.length) {
      const byte = bytes[offset++]
      result += (byte & 0x7f) * Math.pow(2, shift)
      if ((byte & 0x80) === 0) return result
      shift += 7
    }
    throw new Error('Malformed protobuf: truncated varint')
  }

  while (offset < bytes.length) {
    const key = readVarint()
    const number = key >>> 3
    const wireType = key & 7
    if (wireType === 0) {
      fields.push({ number, wireType, value: readVarint() })
    } else if (wireType === 2) {
      const length = readVarint()
      fields.push({ number, wireType, value: bytes.subarray(offset, offset + length) })
      offset += length
    } else if (wireType === 5) {
      fields.push({ number, wireType, value: bytes.subarray(offset, offset + 4) })
      offset += 4
    } else if (wireType === 1) {
      fields.push({ number, wireType, value: bytes.subarray(offset, offset + 8) })
      offset += 8
    } else {
      throw new Error(`Malformed protobuf: unsupported wire type ${wireType}`)
    }
  }

  return fields
}

const decoder = new TextDecoder()

/** Parse a SentencePiece model protobuf into its vocabulary. */
export function parseSentencePieceModel(bytes: Uint8Array): SentencePieceModel {
  const pieces: SentencePiece[] = []
  let unkId = 0

  for (const field of readFields(bytes)) {
    if (field.number !== 1 || field.wireType !== 2) continue

    const message = field.value as Uint8Array
    let piece = ''
    let score = 0
    let type = TYPE_NORMAL

    for (const sub of readFields(message)) {
      if (sub.number === 1 && sub.wireType === 2) piece = decoder.decode(sub.value as Uint8Array)
      else if (sub.number === 2 && sub.wireType === 5) {
        score = new DataView(
          (sub.value as Uint8Array).buffer,
          (sub.value as Uint8Array).byteOffset,
          4
        ).getFloat32(0, true)
      } else if (sub.number === 3 && sub.wireType === 0) {
        type = sub.value as number
      }
    }

    if (type === TYPE_UNKNOWN) unkId = pieces.length
    pieces.push({ piece, score, type })
  }

  if (pieces.length === 0) throw new Error('SentencePiece model has no pieces')
  return { pieces, unkId }
}

// ─── encoder ─────────────────────────────────────────────────────────────────

interface VocabEntry {
  id: number
  score: number
  chars: string[]
}

export class PocketTokenizer {
  private readonly normalPieces = new Map<string, VocabEntry>()
  private readonly bytePieces = new Map<number, number>()
  private readonly maxPieceLength: number
  private readonly scores = new Map<number, number>()
  readonly unkId: number

  constructor(model: SentencePieceModel) {
    this.unkId = model.unkId
    let maxLength = 1

    model.pieces.forEach((piece, id) => {
      this.scores.set(id, piece.score)
      if (piece.type === TYPE_NORMAL) {
        this.normalPieces.set(piece.piece, { id, score: piece.score, chars: [...piece.piece] })
        maxLength = Math.max(maxLength, [...piece.piece].length)
      } else if (piece.type === TYPE_BYTE) {
        // Byte pieces are spelled "<0xNN>".
        const match = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece.piece)
        if (match) this.bytePieces.set(parseInt(match[1], 16), id)
      }
    })

    this.maxPieceLength = maxLength
  }

  /** Normalize text the way the SentencePiece normalizer does. */
  private normalize(text: string): string {
    return META + text.replace(/ /g, META)
  }

  /**
   * Encode text into token ids.
   *
   * The best segmentation of the normalized text is the one with the highest
   * total piece score. A character no piece covers is emitted as its byte
   * pieces.
   */
  encode(text: string): number[] {
    const normalized = this.normalize(text)
    const chars = [...normalized]
    const n = chars.length

    // best[i] is the best score of a path that reaches character i.
    const best = new Float64Array(n + 1).fill(-Infinity)
    const backPiece = new Array<VocabEntry | null>(n + 1).fill(null)
    const backBytes = new Array<number[] | null>(n + 1).fill(null)
    best[0] = 0

    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue

      let matched = false
      const limit = Math.min(n - i, this.maxPieceLength)
      for (let length = 1; length <= limit; length++) {
        const candidate = chars.slice(i, i + length).join('')
        const entry = this.normalPieces.get(candidate)
        if (!entry) continue
        matched = true
        const score = best[i] + entry.score
        if (score > best[i + length]) {
          best[i + length] = score
          backPiece[i + length] = entry
          backBytes[i + length] = null
        }
      }

      if (!matched) {
        // Byte fallback: no piece covers this character, so spell it out in
        // bytes. The penalty keeps the byte path below any real segmentation,
        // so it is only taken when nothing else can cover the character.
        const bytes = this.bytePiecesFor(chars[i])
        const score = best[i] + bytes.length * BYTE_FALLBACK_PENALTY
        if (score > best[i + 1]) {
          best[i + 1] = score
          backPiece[i + 1] = null
          backBytes[i + 1] = bytes
        }
      }
    }

    // Walk the best path backwards.
    const ids: number[] = []
    let position = n
    while (position > 0) {
      const piece = backPiece[position]
      const bytes = backBytes[position]
      if (piece) {
        ids.push(piece.id)
        position -= piece.chars.length
      } else if (bytes) {
        for (let i = bytes.length - 1; i >= 0; i--) ids.push(bytes[i])
        position -= 1
      } else {
        // No path reaches this position: fall back to the unknown piece.
        ids.push(this.unkId)
        position -= 1
      }
    }

    ids.reverse()
    return ids
  }

  private scoreOf(id: number): number {
    return this.scores.get(id) ?? 0
  }

  private bytePiecesFor(char: string): number[] {
    const bytes = new TextEncoder().encode(char)
    return Array.from(bytes, (byte) => this.bytePieces.get(byte) ?? this.unkId)
  }
}
