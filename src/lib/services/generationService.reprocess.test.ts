/**
 * Segments made with another voice or model are not reused.
 *
 * An existing segment is only worth skipping when it was made the way the
 * chapter is read now. A change of voice or engine must make the chapter again,
 * or the listener keeps hearing the old narrator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Every request the worker was asked for, in order. */
const requested: Array<{ text: string; voice?: string; model?: string }> = []

/** The segments the "database" keeps, per chapter. */
const stored = vi.hoisted(
  () =>
    new Map<
      string,
      Array<{ index: number; text: string; voice?: string; model?: string; id?: string }>
    >()
)

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
    generateVoice: vi.fn(async (options: { text: string; voice?: string; modelType?: string }) => {
      requested.push({ text: options.text, voice: options.voice, model: options.modelType })
      await new Promise((resolve) => setTimeout(resolve, 10))
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
    async (
      _bookId: number,
      chapterId: string,
      segments: Array<{ index: number; text: string }>
    ) => {
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
import { selectedModel, selectedVoice } from '../../stores/ttsStore'
import type { Chapter } from '../types/book'

function chapter(id: string, marker: string): Chapter {
  return {
    id,
    title: `Chapter ${id}`,
    content: `<p>${marker} one. ${marker} two. ${marker} three.</p>`,
  }
}

describe('Reusing segments made with another voice', () => {
  beforeEach(async () => {
    requested.length = 0
    stored.clear()
    vi.clearAllMocks()
    generationService.cancel()
    book.set({ title: 'Test Book', author: 'Author', format: 'epub', chapters: [] })
    selectedModel.set('kokoro')
    selectedVoice.set('af_heart')
  })

  it('makes a stored segment again when the voice has changed', async () => {
    const only = chapter('c1', 'Alpha')
    stored.set(
      'c1',
      ['one', 'two', 'three'].map((word, index) => ({
        index,
        text: `Alpha ${word}.`,
        voice: 'af_heart',
        model: 'kokoro',
      }))
    )

    selectedVoice.set('bf_emma')

    await generationService.generateChapters([only], 1)

    const made = requested.filter((request) => request.text.includes('Alpha'))
    expect(made.map((request) => request.text)).toEqual([
      'Alpha one.',
      'Alpha two.',
      'Alpha three.',
    ])
    expect(made.every((request) => request.voice === 'bf_emma')).toBe(true)
  })

  it('keeps stored segments made with the selected voice', async () => {
    const only = chapter('c1', 'Alpha')
    stored.set(
      'c1',
      ['one', 'two', 'three'].map((word, index) => ({
        index,
        text: `Alpha ${word}.`,
        voice: 'af_heart',
        model: 'kokoro',
      }))
    )

    await generationService.generateChapters([only], 1)

    expect(requested.filter((request) => request.text.includes('Alpha'))).toHaveLength(0)
  })
})
