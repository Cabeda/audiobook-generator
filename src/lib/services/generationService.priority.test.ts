/**
 * The generation queue and the reader that has priority over it.
 *
 * What the person is listening to is generated before the rest of the book:
 * the chapter being generated is left where it is — its segments are saved —
 * and the book carries on with the reader's chapter once it is done.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** The text of every segment the worker was asked for, in order. */
const requested: string[] = []

/** The segments the "database" keeps, per chapter. */
const stored = vi.hoisted(() => new Map<string, Array<{ index: number }>>())

vi.mock('../audioPlaybackService.svelte', () => ({
  audioService: {
    stop: vi.fn(),
    loadChapter: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    playFromSegment: vi.fn(),
    playSingleSegment: vi.fn(),
    injectProgressiveSegment: vi.fn(),
    replaceSegmentAudio: vi.fn(),
    setSegmentsAreExternal: vi.fn(),
    playingChapterId: () => null,
  },
}))

vi.mock('../ttsWorkerManager', () => ({
  getTTSWorker: () => ({
    generateVoice: vi.fn(async (options: { text: string }) => {
      requested.push(options.text)
      // Real engines take a moment, so a test can catch the queue mid-chapter.
      await new Promise((resolve) => setTimeout(resolve, 50))
      // A real blob, so the duration can be read from it.
      return new Blob([new Uint8Array(44)], { type: 'audio/wav' })
    }),
    generateSegments: vi.fn(),
    cancelAll: vi.fn(),
    terminate: vi.fn(),
  }),
  terminateTTSWorker: vi.fn(),
}))

vi.mock('../libraryDB', () => ({
  getChapterSegments: vi.fn(
    async (_bookId: number, chapterId: string) => stored.get(chapterId) ?? []
  ),
  saveChapterSegments: vi.fn(
    async (_bookId: number, chapterId: string, segments: Array<{ index: number }>) => {
      const byIndex = new Map((stored.get(chapterId) ?? []).map((s) => [s.index, s]))
      for (const segment of segments) byIndex.set(segment.index, segment)
      stored.set(chapterId, [...byIndex.values()])
    }
  ),
  updateChapterContent: vi.fn(async () => {}),
  updateSegmentStartTimes: vi.fn(async () => {}),
  saveChapterAudio: vi.fn(async () => {}),
  countChapterSegments: vi.fn(async () => 0),
  getBookGenerationStatus: vi.fn(async () => new Set<string>()),
  getChapterAudio: vi.fn(async () => null),
  deleteSegmentsByIndices: vi.fn(async () => {}),
  saveSegmentIndividually: vi.fn(async () => {}),
}))

import { generationService } from './generationService'
import { book } from '../../stores/bookStore'
import type { Chapter } from '../types/book'

function chapter(id: string, marker: string): Chapter {
  return {
    id,
    title: `Chapter ${id}`,
    content: `<p>${marker} one. ${marker} two. ${marker} three.</p>`,
  }
}

describe('The generation queue', () => {
  beforeEach(async () => {
    requested.length = 0
    stored.clear()
    vi.clearAllMocks()
    generationService.cancel()
    book.set({ title: 'Test Book', author: 'Author', format: 'epub', chapters: [] })
  })

  it('generates the chapter the reader is on before the rest of the book', async () => {
    const first = chapter('c1', 'Alpha')
    const second = chapter('c2', 'Beta')
    const readerChapter = chapter('c3', 'Gamma')

    const run = generationService.generateChapters([first, second, readerChapter], 1)

    // The reader opens the last chapter while the book is being generated.
    await vi.waitFor(() => expect(requested.length).toBeGreaterThan(0))
    generationService.prioritizeChapter(readerChapter)

    await run

    // The reader's chapter was made before the one that was queued behind it.
    const gamma = requested.findIndex((text) => text.includes('Gamma'))
    const beta = requested.findIndex((text) => text.includes('Beta'))
    expect(gamma).toBeGreaterThanOrEqual(0)
    expect(beta).toBeGreaterThanOrEqual(0)
    expect(gamma).toBeLessThan(beta)

    // The chapter the service was on was left in the middle: it is finished
    // after the reader's chapter.
    const lastAlpha = requested.map((text) => text.includes('Alpha')).lastIndexOf(true)
    expect(gamma).toBeLessThan(lastAlpha)
  })

  it('leaves the chapter it is on and finishes it afterwards', async () => {
    const first = chapter('c1', 'Alpha')
    const readerChapter = chapter('c2', 'Gamma')

    const run = generationService.generateChapters([first, readerChapter], 1)

    await vi.waitFor(() => expect(requested.length).toBeGreaterThan(0))
    generationService.prioritizeChapter(readerChapter)

    await run

    // Every segment of both chapters was made, in the end.
    const alpha = requested.filter((text) => text.includes('Alpha'))
    const gamma = requested.filter((text) => text.includes('Gamma'))
    expect(alpha).toHaveLength(3)
    expect(gamma).toHaveLength(3)
  })

  it('makes the segment the reader is on before the others', async () => {
    const only = chapter('c1', 'Alpha')

    // The reader is on the last segment of the chapter.
    generationService.setReaderPosition('c1', 2)

    await generationService.generateChapters([only], 1)

    const order = requested.filter((text) => text.includes('Alpha'))
    expect(order[0]).toContain('three')
  })
})
