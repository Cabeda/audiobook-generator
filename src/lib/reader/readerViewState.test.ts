// Specification for how generation state becomes what the reader shows.
// Seam: readerViewState (real stores → the reading UI's view state).
import { describe, expect, it } from 'vitest'
import {
  bookGenerationView,
  bookProgressOf,
  chapterAudioView,
  chapterEstimateSeconds,
  nextChapterFor,
  resumePoint,
  sessionChapterId,
  type ChapterSegmentProgressLike,
} from './readerViewState'

function segments(total: number, generated: number[], generating = false, processing = -1) {
  return {
    totalSegments: total,
    generatedIndices: new Set(generated),
    isGenerating: generating,
    processingIndex: processing,
  } satisfies ChapterSegmentProgressLike
}

describe('chapterAudioView', () => {
  it('shows a chapter with no generation work as not generated', () => {
    expect(chapterAudioView(undefined, 'pending', undefined)).toEqual({
      state: 'none',
      progress: 0,
    })
  })

  it('shows how far a chapter being generated has come', () => {
    expect(chapterAudioView(segments(4, [0, 1], true, 2), 'processing', undefined)).toEqual({
      state: 'generating',
      progress: 0.5,
    })
  })

  it('shows a finished chapter as ready', () => {
    expect(chapterAudioView(segments(3, [0, 1, 2]), 'done', undefined)).toEqual({
      state: 'ready',
      progress: 1,
    })
  })

  it('shows a failed chapter with its error', () => {
    expect(chapterAudioView(segments(2, []), 'error', 'model crashed')).toEqual({
      state: 'failed',
      progress: 0,
      error: 'model crashed',
    })
  })

  it('counts a chapter as generating once it is processing, before segments land', () => {
    expect(chapterAudioView(segments(4, [], true, -1), 'processing', undefined)?.state).toBe(
      'generating'
    )
  })
})

describe('bookGenerationView', () => {
  it('reports the share of the book with audio, by segments', () => {
    const view = bookGenerationView([segments(2, [0]), segments(2, [0, 1]), undefined])
    expect(view.generatedSegments).toBe(3)
    expect(view.totalSegments).toBe(4)
    expect(view.percent).toBeCloseTo(0.75)
  })

  it('reports nothing to do for a book with no segments', () => {
    expect(bookGenerationView([undefined, undefined]).percent).toBe(0)
  })
})

describe('bookProgressOf', () => {
  it('reports where listening is in the book as a whole', () => {
    expect(bookProgressOf([100, 200, 100], 1, 0.5)).toEqual({
      position: 200,
      duration: 400,
      fraction: 0.5,
    })
  })

  it('clamps to the end of the book', () => {
    expect(bookProgressOf([100, 100], 1, 1).fraction).toBe(1)
    expect(bookProgressOf([100, 100], 9, 0.5)).toEqual({ position: 0, duration: 200, fraction: 0 })
  })

  it('estimates a chapter from its word count', () => {
    // 26 words at the app's ~2.6 words/second
    expect(chapterEstimateSeconds('<p>' + 'word '.repeat(26) + '</p>')).toBeCloseTo(10)
  })
})

describe('resumePoint', () => {
  it('restores where the reader left off', () => {
    const chapters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(resumePoint({ chapterId: 'b', segmentIndex: 7 }, chapters)).toEqual({
      chapterIndex: 1,
      segmentIndex: 7,
    })
  })

  it('drops a position whose chapter is gone', () => {
    expect(resumePoint({ chapterId: 'gone', segmentIndex: 3 }, [{ id: 'a' }])).toBeNull()
  })

  it('starts at the top when there is no saved position', () => {
    expect(resumePoint(null, [{ id: 'a' }])).toBeNull()
  })
})

describe('sessionChapterId', () => {
  it('ignores a restored chapter id until the session loads it', () => {
    // The player store restores ids across sessions, and chapter ids repeat
    // across books ('chapter-1'); a restored id must never look like a session.
    expect(sessionChapterId('chapter-1', false)).toBeNull()
    expect(sessionChapterId('chapter-1', true)).toBe('chapter-1')
  })
})

describe('nextChapterFor', () => {
  const chapters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('carries listening into the next chapter when continuing is on', () => {
    expect(nextChapterFor(chapters, 'a', true)).toEqual({ id: 'b' })
  })

  it('stops at the end of the book', () => {
    expect(nextChapterFor(chapters, 'c', true)).toBeNull()
  })

  it('stops when the listener turned continuing off', () => {
    expect(nextChapterFor(chapters, 'a', false)).toBeNull()
    expect(nextChapterFor(chapters, 'missing', true)).toBeNull()
  })
})
