/**
 * Reader view state.
 *
 * The seam between generation state and the reading UI: what a chapter's
 * audiobook looks like (not generated, being generated, ready, failed), how far
 * the book as a whole has come, and where reading should resume. Pure mapping
 * over the store shapes, so the reader components never interpret them.
 */

import type { ChapterStatus } from '../../stores/bookStore'

/** The part of a chapter's segment progress the view state needs. */
export interface ChapterSegmentProgressLike {
  totalSegments: number
  generatedIndices: Set<number>
  isGenerating: boolean
  processingIndex: number
}

/** What the reader shows about one chapter's audio. */
export interface ChapterAudioView {
  state: 'none' | 'generating' | 'ready' | 'failed'
  /** Share of the chapter's segments with audio, 0..1. */
  progress: number
  error?: string
}

/** What the reader shows about the book's audio as a whole. */
export interface BookGenerationView {
  generatedSegments: number
  totalSegments: number
  /** Share of the book's segments with audio, 0..1. */
  percent: number
}

export function chapterAudioView(
  segment: ChapterSegmentProgressLike | undefined,
  status: ChapterStatus | undefined,
  error: string | undefined
): ChapterAudioView {
  const total = segment?.totalSegments ?? 0
  const generated = segment?.generatedIndices.size ?? 0
  const progress = total > 0 ? generated / total : 0

  if (status === 'error') return { state: 'failed', progress, error }

  if (total > 0 && generated >= total) return { state: 'ready', progress }

  const working = status === 'processing' || (segment?.isGenerating ?? false) || generated > 0
  if (working) return { state: 'generating', progress }

  return { state: 'none', progress: 0 }
}

export function bookGenerationView(
  chapters: Array<ChapterSegmentProgressLike | undefined>
): BookGenerationView {
  let generatedSegments = 0
  let totalSegments = 0
  for (const chapter of chapters) {
    totalSegments += chapter?.totalSegments ?? 0
    generatedSegments += chapter?.generatedIndices.size ?? 0
  }
  return {
    generatedSegments,
    totalSegments,
    percent: totalSegments > 0 ? generatedSegments / totalSegments : 0,
  }
}

/** Where reading should resume, or null to start at the top. */
export function resumePoint(
  saved: { chapterId: string; segmentIndex: number } | null,
  chapters: Array<{ id: string }>
): { chapterIndex: number; segmentIndex: number } | null {
  if (!saved) return null
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === saved.chapterId)
  if (chapterIndex < 0) return null
  return { chapterIndex, segmentIndex: saved.segmentIndex }
}
