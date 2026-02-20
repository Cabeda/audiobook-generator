import { writable, derived, get } from 'svelte/store'
import type { AudioSegment } from '../lib/types/audio'
import logger from '../lib/utils/logger'

/**
 * Represents the generation state of segments within a chapter
 */
export interface ChapterSegmentProgress {
  /** Total number of segments in the chapter */
  totalSegments: number
  /** Set of segment indices that have been generated */
  generatedIndices: Set<number>
  /** Map of segment index to its text content (for pre-generation display) */
  segmentTexts: Map<number, string>
  /** Map of segment index to AudioSegment (for playback of completed segments) */
  generatedSegments: Map<number, AudioSegment>
  /** Whether generation is currently in progress */
  isGenerating: boolean
  /** Index of the segment currently being processed (-1 if none) */
  processingIndex: number
  /** Map of segment index to its current quality tier */
  segmentQuality: Map<number, number>
}

/**
 * Store tracking segment-level generation progress for all chapters
 * Key: chapterId, Value: ChapterSegmentProgress
 */
export const segmentProgress = writable(new Map<string, ChapterSegmentProgress>())

/**
 * Initialize segment tracking for a chapter when segmentation begins
 */
export function initChapterSegments(
  chapterId: string,
  segments: Array<{ index: number; text: string; id: string }>
) {
  segmentProgress.update((map) => {
    const newMap = new Map(map)
    const segmentTexts = new Map<number, string>()
    segments.forEach((s) => segmentTexts.set(s.index, s.text))

    const chapterProgress: ChapterSegmentProgress = {
      totalSegments: segments.length,
      generatedIndices: new Set<number>(),
      segmentTexts,
      generatedSegments: new Map(),
      isGenerating: true,
      processingIndex: -1,
      segmentQuality: new Map(),
    }
    newMap.set(chapterId, chapterProgress)
    return newMap
  })
}

/**
 * Mark a segment as generated and store its audio data
 */
export function markSegmentGenerated(chapterId: string, segment: AudioSegment) {
  segmentProgress.update((map) => {
    const progress = map.get(chapterId)
    if (!progress) {
      console.warn(
        `markSegmentGenerated called for uninitialized chapterId "${chapterId}". ` +
          'Did you forget to call initChapterSegments first?'
      )
      return map
    }

    const newMap = new Map(map)
    const newProgress = {
      ...progress,
      generatedIndices: new Set(progress.generatedIndices),
      generatedSegments: new Map(progress.generatedSegments),
    }
    newProgress.generatedIndices.add(segment.index)
    newProgress.generatedSegments.set(segment.index, segment)
    newMap.set(chapterId, newProgress)
    return newMap
  })
}

/**
 * Mark chapter generation as complete
 */
export function markChapterGenerationComplete(chapterId: string) {
  segmentProgress.update((map) => {
    const newMap = new Map(map)
    const progress = newMap.get(chapterId)
    if (progress) {
      newMap.set(chapterId, {
        ...progress,
        isGenerating: false,
      })
    }
    return newMap
  })
}

/**
 * Clear segment progress for a chapter
 */
export function clearChapterSegments(chapterId: string) {
  segmentProgress.update((map) => {
    const newMap = new Map(map)
    newMap.delete(chapterId)
    return newMap
  })
}

/**
 * Update the currently-processing segment index for a chapter
 */
export function setProcessingIndex(chapterId: string, index: number) {
  segmentProgress.update((map) => {
    const progress = map.get(chapterId)
    if (!progress) return map
    const newMap = new Map(map)
    newMap.set(chapterId, { ...progress, processingIndex: index })
    return newMap
  })
}

/**
 * Get segment progress for a specific chapter
 */
export function getChapterSegmentProgress(chapterId: string): ChapterSegmentProgress | undefined {
  return get(segmentProgress).get(chapterId)
}

/**
 * Check if a specific segment has been generated
 */
export function isSegmentGenerated(chapterId: string, segmentIndex: number): boolean {
  const progress = get(segmentProgress).get(chapterId)
  return progress?.generatedIndices.has(segmentIndex) ?? false
}

/**
 * Get a generated segment's audio data
 */
export function getGeneratedSegment(
  chapterId: string,
  segmentIndex: number
): AudioSegment | undefined {
  const progress = get(segmentProgress).get(chapterId)
  return progress?.generatedSegments.get(segmentIndex)
}

/**
 * Update the quality tier for a specific segment
 */
export function updateSegmentQuality(chapterId: string, index: number, tier: number) {
  segmentProgress.update((map) => {
    const progress = map.get(chapterId)
    if (!progress) return map
    const newMap = new Map(map)
    const newQuality = new Map(progress.segmentQuality)
    newQuality.set(index, tier)
    newMap.set(chapterId, { ...progress, segmentQuality: newQuality })
    return newMap
  })
}

/**
 * Derived store: percentage complete for each chapter
 */
export const segmentProgressPercentage = derived(segmentProgress, ($progress) => {
  const percentages = new Map<string, number>()
  $progress.forEach((progress, chapterId) => {
    if (progress.totalSegments === 0) {
      percentages.set(chapterId, 0)
    } else {
      percentages.set(
        chapterId,
        Math.round((progress.generatedIndices.size / progress.totalSegments) * 100)
      )
    }
  })
  return percentages
})

/**
 * Load segment progress from DB for chapters that have been partially or fully generated
 */
export async function loadChapterSegmentProgress(bookId: number, chapterId: string) {
  try {
    logger.info(
      `[loadChapterSegmentProgress] Loading segments for bookId=${bookId}, chapterId=${chapterId}`
    )
    const { getChapterSegments } = await import('../lib/libraryDB')
    const segments = await getChapterSegments(bookId, chapterId)
    logger.info(`[loadChapterSegmentProgress] Loaded ${segments.length} segments from DB`)

    if (segments.length > 0) {
      segmentProgress.update((map) => {
        const newMap = new Map(map)
        const segmentTexts = new Map<number, string>()
        const generatedIndices = new Set<number>()
        const generatedSegments = new Map<number, AudioSegment>()

        segments.forEach((s) => {
          segmentTexts.set(s.index, s.text)
          generatedIndices.add(s.index)
          generatedSegments.set(s.index, s)
        })

        newMap.set(chapterId, {
          totalSegments: segments.length,
          generatedIndices,
          segmentTexts,
          generatedSegments,
          isGenerating: false,
          processingIndex: -1,
          segmentQuality: new Map(segments.map((s) => [s.index, s.qualityTier ?? 0])),
        })
        return newMap
      })
    }
  } catch (error) {
    logger.error(`[loadChapterSegmentProgress] Failed to load segments:`, error)
    throw error
  }
}
