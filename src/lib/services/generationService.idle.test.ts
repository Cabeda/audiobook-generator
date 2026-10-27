/**
 * Waiting for the current generation run to finish.
 *
 * Used when a voice change lands mid-run: the worker belongs to that run, so
 * the chapter can only be made again once the run is over.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const requested: string[] = []

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
      await new Promise((resolve) => setTimeout(resolve, 50))
      return new Blob([new Uint8Array(44)], { type: 'audio/wav' })
    }),
    generateSegments: vi.fn(),
    cancelAll: vi.fn(),
    terminate: vi.fn(),
  }),
  terminateTTSWorker: vi.fn(),
}))

vi.mock('../libraryDB', () => ({
  getChapterSegments: vi.fn(async () => []),
  saveChapterSegments: vi.fn(async () => {}),
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

describe('whenIdle', () => {
  beforeEach(() => {
    requested.length = 0
    vi.clearAllMocks()
    generationService.cancel()
    book.set({ title: 'Test Book', author: 'Author', format: 'epub', chapters: [] })
  })

  it('resolves immediately when nothing is running', async () => {
    await expect(generationService.whenIdle()).resolves.toBeUndefined()
  })

  it('waits for the run in progress to finish', async () => {
    const run = generationService.generateChapters([chapter('c1', 'Alpha')], 1)
    await vi.waitFor(() => expect(requested.length).toBeGreaterThan(0))

    let resolved = false
    const idle = generationService.whenIdle().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    await run
    await idle
    expect(resolved).toBe(true)
    expect(generationService.isRunning()).toBe(false)
  })
})
