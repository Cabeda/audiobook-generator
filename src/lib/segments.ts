/**
 * Segment module.
 *
 * Owns segment identity and the segment record. Every path that creates a
 * segment goes through here, so a segment's id means the same thing in the
 * reader, in the database and in the exported EPUB.
 */

import type { AudioSegment } from './types/audio'

/**
 * The id of a segment within its chapter.
 *
 * It matches the id the segmentation service puts on the <span> it wraps in
 * the chapter content, so the EPUB export can tie a segment to the text it
 * belongs to.
 */
export const SEGMENT_ID_PREFIX = 'seg-'

export function segmentId(index: number): string {
  return `${SEGMENT_ID_PREFIX}${index}`
}

/** Create the record for one chunk of generated audio. */
export function createSegment(init: {
  chapterId: string
  index: number
  text: string
  audioBlob: Blob
  duration?: number
  startTime?: number
  qualityTier?: number
  voice?: string
  model?: string
}): AudioSegment {
  return {
    id: segmentId(init.index),
    chapterId: init.chapterId,
    index: init.index,
    text: init.text,
    audioBlob: init.audioBlob,
    duration: init.duration ?? 0,
    startTime: init.startTime ?? 0,
    ...(init.qualityTier !== undefined ? { qualityTier: init.qualityTier } : {}),
    ...(init.voice !== undefined ? { voice: init.voice } : {}),
    ...(init.model !== undefined ? { model: init.model } : {}),
  }
}
