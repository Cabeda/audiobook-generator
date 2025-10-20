import { tokenize } from './tokenizer.ts'

export interface TextChunk {
  type: 'text' | 'silence'
  content?: string
  tokens?: number[]
  durationSeconds?: number
}

export function sanitizeText(rawText: string): string {
  return rawText
    .replace(/\.\s+/g, '[0.4s]')
    .replace(/,\s+/g, '[0.2s]')
    .replace(/;\s+/g, '[0.4s]')
    .replace(/:\s+/g, '[0.3s]')
    .replace(/!\s+/g, '![0.1s]')
    .replace(/\?\s+/g, '?[0.1s]')
    .replace(/\n+/g, '[0.4s]')
    .trim()
}

export function segmentText(sanitizedText: string): string[] {
  const regex = /(\[[0-9]+(?:\.[0-9]+)?s\])/g
  return sanitizedText
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function createPhonemeSubChunks(phonemes: string, tokensPerChunk: number): string[] {
  if (phonemes.length <= tokensPerChunk) return [phonemes]
  const chunks: string[] = []
  let current = ''
  for (const ch of phonemes) {
    if (current.length >= tokensPerChunk) {
      chunks.push(current)
      current = ''
    }
    current += ch
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function phonemize(text: string): Promise<string> {
  // Placeholder phonemizer: uppercase text
  return Promise.resolve(text.toUpperCase())
}

export async function preprocessText(
  text: string,
  _lang: string = 'en',
  tokensPerChunk: number = 200
): Promise<TextChunk[]> {
  const chunks: TextChunk[] = []
  const sanitized = sanitizeText(text)
  const segments = segmentText(sanitized)
  for (const segment of segments) {
    if (/^\[[0-9]+(?:\.[0-9]+)?s\]$/.test(segment)) {
      const duration = parseFloat(segment.replace(/[[\]s]/g, ''))
      chunks.push({ type: 'silence', durationSeconds: duration })
      continue
    }
    const phonemized = await phonemize(segment)
    const phonemeChunks = createPhonemeSubChunks(phonemized, tokensPerChunk)
    for (const pc of phonemeChunks) {
      const tokens = tokenize(pc)
      chunks.push({ type: 'text', content: pc, tokens })
    }
  }
  return chunks
}
