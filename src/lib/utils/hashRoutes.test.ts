import { describe, expect, it } from 'vitest'
import {
  buildAudiobookHash,
  buildBookHash,
  buildReaderHash,
  parseHash,
  shellViewFromHash,
} from './hashRoutes'

const sampleBook = { title: 'The Great Adventure', author: 'Jane Doe', chapters: [] }

describe('hashRoutes', () => {
  it('builds book hash with slug', () => {
    const hash = buildBookHash(12, sampleBook as any)
    expect(hash).toBe('#/book/12/the-great-adventure-jane-doe')
  })

  it('builds reader hash with encoded chapter and slug', () => {
    const hash = buildReaderHash(5, 'chapter 1', sampleBook as any)
    expect(hash).toBe('#/reader/5/chapter%201/the-great-adventure-jane-doe')
  })

  it('parses book hash with slug', () => {
    const parsed = parseHash('#/book/12/the-great-adventure-jane-doe')
    expect(parsed).toEqual({ view: 'book', bookId: 12 })
  })

  it('parses reader hash with slug and decodes chapter id', () => {
    const parsed = parseHash('#/reader/7/chapter%201/the-great-adventure-jane-doe')
    expect(parsed).toEqual({ view: 'reader', bookId: 7, chapterId: 'chapter 1' })
  })

  it('parses unsaved book hash without slug', () => {
    const parsed = parseHash('#/book/unsaved')
    expect(parsed).toEqual({ view: 'book', bookId: 'unsaved' })
  })

  it('returns landing for root hashes', () => {
    expect(parseHash('#/')).toEqual({ view: 'landing' })
    expect(parseHash('#')).toEqual({ view: 'landing' })
    expect(parseHash(undefined)).toEqual({ view: 'landing' })
  })

  it('parses settings hash', () => {
    expect(parseHash('#/settings')).toEqual({ view: 'settings' })
  })

  it('returns null for invalid hashes', () => {
    expect(parseHash('#/unknown/route')).toBeNull()
    expect(parseHash('#/book/not-a-number/slug')).toBeNull()
  })
})

// What the revamp shell restores from a deep link.
describe('shellViewFromHash', () => {
  it('restores the book and the chapter to resume at from a reader link', () => {
    expect(shellViewFromHash(buildReaderHash(7, 'ch-2', sampleBook))).toEqual({
      kind: 'reader',
      bookId: 7,
      chapterId: 'ch-2',
    })
  })

  it('restores the book at the top from a book link', () => {
    expect(shellViewFromHash(buildBookHash(7, sampleBook))).toEqual({
      kind: 'reader',
      bookId: 7,
      chapterId: null,
    })
  })

  it('opens the library from its own link, and home is the reader', () => {
    // '#/' is the default the writer emits; it must never open an overlay,
    // while '#/library' is the books page and survives refresh.
    expect(shellViewFromHash('#/library')).toEqual({ kind: 'library' })
    expect(shellViewFromHash('#/')).toEqual({ kind: 'reader', bookId: 'unsaved', chapterId: null })
  })

  it('opens app settings from the settings link', () => {
    expect(shellViewFromHash('#/settings')).toEqual({ kind: 'settings' })
  })

  it('opens the activity page from its link', () => {
    expect(shellViewFromHash('#/activity')).toEqual({ kind: 'activity' })
    expect(parseHash('#/activity')).toEqual({ view: 'activity' })
  })

  it('opens a book’s audiobook page from its link', () => {
    const hash = buildAudiobookHash(7, sampleBook)
    expect(parseHash(hash)).toEqual({ view: 'audiobook', bookId: 7 })
    expect(shellViewFromHash(hash)).toEqual({ kind: 'audiobook', bookId: 7 })
  })

  it('restores nothing from an invalid link', () => {
    expect(shellViewFromHash('#/book/not-a-number')).toBeNull()
  })
})
