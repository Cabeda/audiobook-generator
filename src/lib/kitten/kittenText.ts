/**
 * Text to token ids for KittenTTS 0.8.
 *
 * Upstream phonemizes with espeak-ng (en-us, punctuation and stress kept),
 * splits the phonemes on word runs, joins them back with single spaces, maps
 * each character through a fixed table and frames the result with a pad token
 * and an explicit end pair. This is that pipeline, in that order: the joining
 * is what inserts the spaces between punctuation, and it is load-bearing
 * because a space is a token the model was trained on.
 */

import { phonemize } from 'phonemizer'
import { symbolId } from './kittenSymbols'

const PAD = 0
const END = 10

/** Upstream chunks at 400 characters and so do we. */
const CHUNK_LIMIT = 400

/**
 * Python's `\w` covers every Unicode letter and number, and upstream's
 * tokenizer is written against it (`\w+|[^\w\s]`). `\p{L}` is the closest
 * equivalent, and it matters: the IPA letters and the modifier letters espeak
 * emits for stress are letters, so they stay inside a word run.
 */
const TOKEN_RUN = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu

/** Token ids for an already phonemized string, framed for the graph. */
export function tokenIdsForPhonemes(phonemes: string): number[] {
  const tokens = phonemes.match(TOKEN_RUN) ?? []
  const ids = [PAD]

  for (const char of tokens.join(' ')) {
    const id = symbolId(char)
    if (id !== undefined) ids.push(id)
  }

  ids.push(END, PAD)
  return ids
}

/** Phonemize, then tokenize. */
export async function tokenIdsForText(text: string): Promise<number[]> {
  const [phonemes] = await phonemize(text, 'en-us')
  return tokenIdsForPhonemes(phonemes ?? '')
}

/**
 * Split into chunks the model can handle. Same 400-character budget as
 * upstream: sentences first, then words for a sentence that is still too long.
 */
export function splitForKitten(text: string, maxLength: number = CHUNK_LIMIT): string[] {
  const chunks: string[] = []

  for (const raw of text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? []) {
    const sentence = raw.trim()
    if (!sentence) continue

    if (sentence.length <= maxLength) {
      chunks.push(withPunctuation(sentence))
      continue
    }

    let current = ''
    for (const word of sentence.split(/\s+/)) {
      if (current.length + word.length + 1 <= maxLength) {
        current = current ? `${current} ${word}` : word
      } else {
        if (current) chunks.push(withPunctuation(current))
        current = word
      }
    }
    if (current) chunks.push(withPunctuation(current))
  }

  return chunks
}

/** The model drifts into repetition on a chunk with no closing punctuation. */
function withPunctuation(chunk: string): string {
  return /[.!?…]$/.test(chunk) ? chunk : `${chunk}.`
}
