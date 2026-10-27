/**
 * Reader view state.
 *
 * The seam between generation state and the reading UI: what a chapter's
 * audiobook looks like (not generated, being generated, ready, failed), how far
 * the book as a whole has come, and where reading should resume. Pure mapping
 * over the store shapes, so the reader components never interpret them.
 */

import type { ChapterStatus } from '../../stores/bookStore'
import { htmlToText } from '../html/chapterHtml'

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

/** Seconds of speech a chapter's text is worth (the app's ~2.6 words/second). */
export function chapterEstimateSeconds(content: string): number {
  const words = htmlToText(content).split(/\s+/).filter(Boolean).length
  return words / 2.6
}

/**
 * Where listening is in the book as a whole: the chapters before the current
 * one plus the share of the current chapter already played.
 */
export function bookProgressOf(
  estimates: number[],
  chapterIndex: number,
  chapterFraction: number
): { position: number; duration: number; fraction: number } {
  const duration = estimates.reduce((total, seconds) => total + seconds, 0)
  if (duration <= 0 || chapterIndex < 0 || chapterIndex >= estimates.length) {
    return { position: 0, duration, fraction: 0 }
  }
  const before = estimates.slice(0, chapterIndex).reduce((total, seconds) => total + seconds, 0)
  const share = Math.min(1, Math.max(0, chapterFraction))
  const position = Math.min(duration, before + estimates[chapterIndex] * share)
  return { position, duration, fraction: position / duration }
}

/**
 * The chapter listening carries into when one ends: the next in the book,
 * or null when the listener turned continuing off or the book is finished.
 */
export function nextChapterFor<T extends { id: string }>(
  chapters: T[],
  finishedChapterId: string,
  autoContinue: boolean
): T | null {
  if (!autoContinue) return null
  const index = chapters.findIndex((chapter) => chapter.id === finishedChapterId)
  if (index < 0) return null
  return chapters[index + 1] ?? null
}

/**
 * The chapter a listening session is actually on.
 *
 * The player store restores a chapter id across sessions, but a restored id is
 * not a session: only report it once this session has loaded audio for it.
 */
export function sessionChapterId(
  storedChapterId: string | null,
  hasLoadedAudio: boolean
): string | null {
  return hasLoadedAudio ? storedChapterId : null
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
