import type { Book } from '../types/book'
import { createBookSlug } from './slug'

type BookId = number | 'unsaved'

export function bookSlugSegment(book: Book | null | undefined): string {
  const slug = createBookSlug(book)
  return slug ? `/${slug}` : ''
}

export function buildBookHash(id: BookId, book: Book | null | undefined): string {
  return `#/book/${id}${bookSlugSegment(book)}`
}

export function buildReaderHash(
  id: BookId,
  chapterId: string,
  book: Book | null | undefined
): string {
  return `#/reader/${id}/${encodeURIComponent(chapterId)}${bookSlugSegment(book)}`
}

export function buildAudiobookHash(id: BookId, book: Book | null | undefined): string {
  return `#/audiobook/${id}${bookSlugSegment(book)}`
}

export const ACTIVITY_HASH = '#/activity'

export type ParsedHash =
  | { view: 'landing' }
  | { view: 'settings' }
  | { view: 'activity' }
  | { view: 'audiobook'; bookId: BookId }
  | { view: 'book'; bookId: BookId }
  | { view: 'reader'; bookId: BookId; chapterId: string }

export function parseHash(hash: string | null | undefined): ParsedHash | null {
  if (!hash || hash === '#/' || hash === '#' || hash === '#/upload' || hash === '#/library')
    return { view: 'landing' }

  if (hash === '#/settings') return { view: 'settings' }
  if (hash === '#/activity') return { view: 'activity' }

  const audiobookMatch = hash.match(/^#\/audiobook\/([^/]+)(?:\/[^/]+)?$/)
  if (audiobookMatch) {
    const rawId = audiobookMatch[1]
    if (rawId === 'unsaved') return { view: 'audiobook', bookId: 'unsaved' }
    const parsedId = parseInt(rawId, 10)
    if (Number.isNaN(parsedId)) return null
    return { view: 'audiobook', bookId: parsedId }
  }

  const bookMatch = hash.match(/^#\/book\/([^/]+)(?:\/[^/]+)?$/)
  if (bookMatch) {
    const rawId = bookMatch[1]
    if (rawId === 'unsaved') return { view: 'book', bookId: 'unsaved' }
    const parsedId = parseInt(rawId, 10)
    if (Number.isNaN(parsedId)) return null
    return { view: 'book', bookId: parsedId }
  }

  const readerMatch = hash.match(/^#\/reader\/([^/]+)\/([^/]+)(?:\/[^/]+)?$/)
  if (readerMatch) {
    const rawId = readerMatch[1]
    const chapterId = decodeURIComponent(readerMatch[2])
    if (rawId === 'unsaved') return { view: 'reader', bookId: 'unsaved', chapterId }
    const parsedId = parseInt(rawId, 10)
    if (Number.isNaN(parsedId)) return null
    return { view: 'reader', bookId: parsedId, chapterId }
  }

  return null
}

/** What the revamp shell restores: reader (optionally at a chapter), or a page. */
export type ShellView =
  | { kind: 'reader'; bookId: BookId; chapterId: string | null }
  | { kind: 'library' }
  | { kind: 'settings' }
  | { kind: 'activity' }
  | { kind: 'audiobook'; bookId: BookId }

export function shellViewFromHash(hash: string | null | undefined): ShellView | null {
  const parsed = parseHash(hash)
  if (!parsed) return null
  switch (parsed.view) {
    case 'reader':
      return { kind: 'reader', bookId: parsed.bookId, chapterId: parsed.chapterId }
    case 'book':
      return { kind: 'reader', bookId: parsed.bookId, chapterId: null }
    case 'settings':
      return { kind: 'settings' }
    case 'activity':
      return { kind: 'activity' }
    case 'audiobook':
      return { kind: 'audiobook', bookId: parsed.bookId }
    case 'landing':
      return { kind: 'library' }
  }
}
