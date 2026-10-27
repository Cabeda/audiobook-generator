/**
 * Book session.
 *
 * The book lifecycle the revamp UI drives: import a file or URL, open, remove,
 * and per-chapter overrides (model, voice, language). Overrides are persisted
 * as they are applied and mirrored into the book in hand, so the reader sees
 * the change at once and it survives a reload.
 */

import { loadBook } from '../bookLoader'
import type { Book } from '../types/book'
import {
  addBook,
  deleteBook,
  getBook,
  updateChapterLanguage,
  updateChapterModel,
  updateChapterVoice,
  updateLastAccessed,
  type LibraryBook,
} from '../libraryDB'

export interface ChapterOverride {
  model?: string
  voice?: string
  language?: string
}

/** Import a file, or a URL to fetch first, into the library. */
export async function importBook(source: { file: File } | { url: string }): Promise<LibraryBook> {
  const parsed = 'file' in source ? await loadBook(source.file) : await loadFromUrl(source.url)
  const id = await addBook(
    parsed,
    'file' in source ? source.file : undefined,
    'url' in source ? source.url : undefined
  )

  // Best effort, as in the old flow: without detection the book simply keeps
  // its declared language and the defaults pick the voice.
  try {
    const { detectAndPersistLanguagesForBook } = await import('./languageDetectionService')
    await detectAndPersistLanguagesForBook(id, parsed)
  } catch {
    // detection unavailable — carry on with the parsed languages
  }

  return (await getBook(id)) ?? ({ id, ...parsed } as LibraryBook)
}

/**
 * A URL may be a book (EPUB, PDF, TXT) or a page to read as an article.
 *
 * Pages go through Readability, which is the same extraction Readeck uses, so a
 * link becomes the article and not the page around it. Anything it cannot read
 * as an article falls back to the whole-page parser.
 */
async function loadFromUrl(url: string): Promise<Book> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not fetch URL — HTTP ${response.status}`)

  const contentType = response.headers.get('content-type') ?? ''
  const pathname = pathnameOf(url)
  const namesAFile = /\.[a-z0-9]{2,5}$/i.test(pathname)

  if (/text\/html|application\/xhtml/i.test(contentType) || !namesAFile) {
    const html = await response.text()
    const { parseArticle } = await import('../parsers/articleParser')
    const article = parseArticle(html, url)
    if (article) return article
    return loadBook(new File([html], 'page.html', { type: 'text/html' }))
  }

  const blob = await response.blob()
  const name = pathname.split('/').pop() || 'book.epub'
  return loadBook(new File([blob], name, { type: blob.type }))
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** Open a book, marking it as read now so the library sorts by recency. */
export async function openBook(id: number): Promise<LibraryBook | null> {
  const book = await getBook(id)
  if (book) await updateLastAccessed(id)
  return book
}

/** Remove a book and everything generated for it. */
export async function removeBook(id: number): Promise<void> {
  await deleteBook(id)
}

/**
 * Apply a per-chapter override and persist it through its own store. Fields
 * left out are untouched, so the UI can save one change at a time.
 */
export async function setChapterOverride(
  book: LibraryBook,
  chapterId: string,
  override: ChapterOverride
): Promise<void> {
  const bookId = book.id
  if (bookId == null) throw new Error('Book is not in the library')

  const chapter = book.chapters.find((c) => c.id === chapterId)
  if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`)

  const jobs: Promise<void>[] = []
  if (override.model !== undefined) {
    chapter.model = override.model
    jobs.push(updateChapterModel(bookId, chapterId, override.model))
  }
  if (override.voice !== undefined) {
    chapter.voice = override.voice
    jobs.push(updateChapterVoice(bookId, chapterId, override.voice))
  }
  if (override.language !== undefined) {
    chapter.language = override.language
    jobs.push(updateChapterLanguage(bookId, chapterId, override.language))
  }
  await Promise.all(jobs)
}
