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

export type ParsedHash =
  | { view: 'landing' }
  | { view: 'settings' }
  | { view: 'book'; bookId: BookId }
  | { view: 'reader'; bookId: BookId; chapterId: string }

export function parseHash(hash: string | null | undefined): ParsedHash | null {
  if (!hash || hash === '#/' || hash === '#' || hash === '#/upload' || hash === '#/library')
    return { view: 'landing' }

  if (hash === '#/settings') return { view: 'settings' }

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
