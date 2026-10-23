// Specification for the generation and export actions the revamp UI drives.
// Seam: audiobookService (UI → generationService/exportService + bookStore).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book, Chapter } from '../types/book'

vi.mock('../services/generationService', () => ({
  generationService: {
    generateChapters: vi.fn(async () => undefined),
    generateSingleChapterFromSegment: vi.fn(async () => undefined),
  },
}))

vi.mock('../services/exportService', () => ({
  exportAudio: vi.fn(async () => undefined),
  exportEpub: vi.fn(async () => undefined),
}))

const { generationService } = await import('../services/generationService')
const exporter = await import('../services/exportService')
const { get } = await import('svelte/store')
const { chapterErrors, chapterStatus } = await import('../../stores/bookStore')
const { exportBook, generateMissing, retryChapters } = await import('./audiobookService')

function chapter(id: string): Chapter {
  return { id, title: id, content: '<p>x</p>' }
}

const book = {
  title: 'The Quiet Mill',
  author: 'Demo Author',
  chapters: [chapter('c1'), chapter('c2'), chapter('c3')],
}

beforeEach(() => {
  vi.clearAllMocks()
  chapterStatus.set(new Map())
  chapterErrors.set(new Map())
})

describe('generateMissing', () => {
  it('generates only the chapters that still need audio', async () => {
    chapterStatus.set(new Map([['c1', 'done']]) as never)

    await generateMissing(book as Book)

    const queued = vi.mocked(generationService.generateChapters).mock.calls[0][0]
    expect(queued.map((c) => c.id)).toEqual(['c2', 'c3'])
  })
})

describe('retryChapters', () => {
  it('clears the chapter error and generates it again', async () => {
    chapterErrors.set(new Map([['c2', 'model crashed']]))
    chapterStatus.set(new Map([['c2', 'error']]) as never)

    await retryChapters(book as Book, ['c2'])

    expect([...get(chapterErrors).keys()]).not.toContain('c2')
    const queued = vi.mocked(generationService.generateChapters).mock.calls[0][0]
    expect(queued.map((c) => c.id)).toEqual(['c2'])
  })
})

describe('exportBook', () => {
  it('exports the book audio with the chosen format and bitrate', async () => {
    await exportBook(book as Book, { format: 'mp3', bitrate: 128 })

    expect(exporter.exportAudio).toHaveBeenCalledWith(
      book.chapters,
      'mp3',
      128,
      expect.objectContaining({ title: 'The Quiet Mill', author: 'Demo Author' })
    )
  })

  it('exports the book itself for epub, carrying its cover', async () => {
    const cover = new Blob(['png'], { type: 'image/png' })

    await exportBook(book as Book, { format: 'epub', cover })

    expect(exporter.exportEpub).toHaveBeenCalledWith(
      book.chapters,
      expect.objectContaining({ title: 'The Quiet Mill', cover })
    )
    expect(exporter.exportAudio).not.toHaveBeenCalled()
  })
})
