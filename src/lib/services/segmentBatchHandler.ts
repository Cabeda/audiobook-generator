/**
 * Batched segment persistence handler.
 *
 * Accumulates generated audio segments and flushes them to IndexedDB in
 * batches to reduce the number of database transactions during generation.
 * Also tracks flushed segments so their in-memory blob references can be
 * released to keep peak memory low on constrained devices (Android).
 *
 * Extracted from generationService to isolate persistence concerns.
 */

import { saveChapterSegments } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import logger from '../utils/logger'
import { markSegmentGenerated } from '../../stores/segmentProgressStore'

export class SegmentBatchHandler {
  private batch: AudioSegment[] = []
  private readonly batchSize: number
  private readonly bookId: number | undefined
  private readonly chapterId: string
  /** Segments whose blobs have been persisted and can be released from memory */
  private flushedSegments: AudioSegment[] = []

  constructor(bookId: number | undefined, chapterId: string, batchSize: number = 10) {
    this.bookId = bookId
    this.chapterId = chapterId
    this.batchSize = batchSize
  }

  /**
   * Add a segment to the batch and save if batch is full.
   * Marks the segment as generated in the UI immediately for real-time feedback.
   *
   * Note: Segments are marked as generated before batch flush for better UX.
   * If a batch flush fails, the final saveChapterSegments call (after all segments
   * are generated) will ensure all segments are eventually persisted.
   */
  async addSegment(segment: AudioSegment): Promise<void> {
    if (this.bookId) {
      this.batch.push(segment)

      // If batch is full, flush it
      if (this.batch.length >= this.batchSize) {
        try {
          await this.flush()
        } catch (error) {
          // Log the error but don't stop generation
          // The final saveChapterSegments call will ensure these segments are saved
          logger.error('Failed to flush segment batch in addSegment, continuing generation', {
            error,
            chapterId: this.chapterId,
          })
        }
      }

      // Mark segment as generated in UI immediately
      // This provides real-time feedback while batching saves for performance
      markSegmentGenerated(this.chapterId, segment)
    } else {
      // No persistent storage; just mark as generated
      markSegmentGenerated(this.chapterId, segment)
    }
  }

  /**
   * Flush any remaining segments in the batch to the database.
   * Uses `put` operations which are idempotent (upsert), so duplicate saves are safe.
   */
  async flush(): Promise<void> {
    if (this.batch.length === 0 || !this.bookId) {
      logger.debug(
        `[SegmentBatchHandler] Skipping flush: batch=${this.batch.length}, bookId=${this.bookId}`
      )
      return
    }

    try {
      logger.info(
        `[SegmentBatchHandler] Flushing ${this.batch.length} segments for chapter ${this.chapterId}, bookId=${this.bookId}`
      )
      await saveChapterSegments(this.bookId, this.chapterId, this.batch)
      logger.debug(`Flushed batch of ${this.batch.length} segments for chapter ${this.chapterId}`)
      // Track flushed segments so their blobs can be released
      this.flushedSegments.push(...this.batch)
      this.batch = []
    } catch (error) {
      logger.error('Failed to save segment batch', {
        error,
        bookId: this.bookId,
        chapterId: this.chapterId,
        batchSize: this.batch.length,
      })
      // Clear batch even on error to avoid retry loops
      // The final saveChapterSegments call will ensure these segments are saved
      this.batch = []
      throw error
    }
  }

  /**
   * Release audioBlob references from all flushed segments to free memory.
   * Call this after flush() to reduce peak memory on constrained devices (e.g. Android).
   * Segments retain their metadata (id, index, duration, startTime, text) for later use.
   */
  releaseBlobs(): void {
    for (const seg of this.flushedSegments) {
      // Cast to allow null — the blob data is safely in IndexedDB
      ;(seg as { audioBlob: Blob | null }).audioBlob = null
    }
    if (this.flushedSegments.length > 0) {
      logger.debug(
        `[SegmentBatchHandler] Released ${this.flushedSegments.length} blob references for chapter ${this.chapterId}`
      )
    }
    this.flushedSegments = []
  }
}
