import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import {
  segmentProgress,
  initChapterSegments,
  markSegmentGenerated,
} from '../../stores/segmentProgressStore'
import type { AudioSegment } from '../types/audio'

/**
 * Regression test for segmentProgressStore sliding window eviction (PR #174)
 * Ensures that only MAX_BLOBS_IN_MEMORY (20) blobs are kept in memory.
 */
describe('segmentProgressStore sliding window eviction', () => {
  const chapterId = 'test-eviction-chapter'
  const makeSegment = (index: number): AudioSegment => ({
    id: `${chapterId}-seg-${index}`,
    chapterId,
    index,
    text: `Segment ${index}`,
    audioBlob: new Blob([`audio-${index}`], { type: 'audio/wav' }),
    duration: 1.0,
    startTime: index,
  })

  it('should keep at most 20 blobs with actual data in memory', () => {
    // Initialize 30 segments
    const segments = Array.from({ length: 30 }, (_, i) => ({
      index: i,
      text: `Segment ${i}`,
      id: `seg-${i}`,
    }))
    initChapterSegments(chapterId, segments)

    // Generate all 30 segments
    for (let i = 0; i < 30; i++) {
      markSegmentGenerated(chapterId, makeSegment(i))
    }

    const progress = get(segmentProgress).get(chapterId)
    expect(progress).toBeDefined()
    expect(progress!.generatedIndices.size).toBe(30) // All marked as generated
    expect(progress!.generatedSegments.size).toBe(30) // All have entries

    // Count segments with actual blobs (non-null audioBlob)
    let blobCount = 0
    for (const [, seg] of progress!.generatedSegments) {
      if (seg.audioBlob && seg.audioBlob instanceof Blob && seg.audioBlob.size > 0) {
        blobCount++
      }
    }

    // Should have at most 20 actual blobs
    expect(blobCount).toBeLessThanOrEqual(20)
    // Evicted segments should still have metadata
    const firstSegment = progress!.generatedSegments.get(0)
    expect(firstSegment).toBeDefined()
    expect(firstSegment!.text).toBe('Segment 0')
  })

  it('should not evict when under the limit', () => {
    const smallChapterId = 'test-small-chapter'
    const segments = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      text: `Segment ${i}`,
      id: `seg-${i}`,
    }))
    initChapterSegments(smallChapterId, segments)

    for (let i = 0; i < 10; i++) {
      markSegmentGenerated(smallChapterId, makeSegment(i))
    }

    const progress = get(segmentProgress).get(smallChapterId)
    expect(progress).toBeDefined()

    // All should have real blobs
    let blobCount = 0
    for (const [, seg] of progress!.generatedSegments) {
      if (seg.audioBlob && seg.audioBlob instanceof Blob && seg.audioBlob.size > 0) {
        blobCount++
      }
    }
    expect(blobCount).toBe(10)
  })
})
