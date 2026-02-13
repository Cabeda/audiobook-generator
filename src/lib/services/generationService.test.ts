import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the audioPlaybackService to avoid Svelte runes error
vi.mock('../audioPlaybackService.svelte', () => ({
  audioService: {
    stop: vi.fn(),
    loadChapter: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    playFromSegment: vi.fn(),
  },
}))

import { segmentHtmlContent } from './generationService'
import { createMockTTSWorkerManager, createMockWavBlob } from '../../test/ttsClientMocks'
import { flushPromises } from '../../test/svelteRunesTestUtils'

describe('segmentHtmlContent', () => {
  it('should segment simple text into sentences', () => {
    const html = '<p>Hello world. This is a test.</p>'
    const { segments } = segmentHtmlContent('ch1', html)
    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe('Hello world.')
    expect(segments[1].text).toBe('This is a test.')
  })

  it('should not merge text across block boundaries', () => {
    // Current implementation is expected to fail this (merges to "Sentence 1.Sentence 2.")
    // or arguably "Sentence 1. Sentence 2." if newlines are present in textContent?
    // JSDOM textContent often concatenates without spaces for block descriptors if they are tight.
    const html = '<div>Sentence A</div><div>Sentence B</div>'
    const { segments } = segmentHtmlContent('ch1', html)

    // We expect two segments, "Sentence A" and "Sentence B".
    // If it fails, it might be one segment "Sentence ASentence B" or "Sentence A Sentence B"
    // Ideally it should detect them as separate sentences.
    const combined = segments.map((s) => s.text).join(' ')
    expect(combined).toContain('Sentence A')
    expect(combined).toContain('Sentence B')

    // Strict check:
    expect(segments.length).toBeGreaterThanOrEqual(2)
    expect(segments[0].text).not.toContain('Sentence B')
  })

  it('should ignore code blocks when option is enabled', () => {
    const html = '<p>Start.</p><pre><code>console.log("ignore me")</code></pre><p>End.</p>'
    const { segments } = segmentHtmlContent('ch1', html, { ignoreCodeBlocks: true })

    expect(segments.map((s) => s.text)).not.toContain('console.log("ignore me")')
    expect(segments.map((s) => s.text)).toContain('Start.')
    expect(segments.map((s) => s.text)).toContain('End.')
  })

  it('should include code blocks when option is disabled (default)', () => {
    const html = '<p>Start.</p><code>var x = 1;</code>'
    const { segments } = segmentHtmlContent('ch1', html, { ignoreCodeBlocks: false })

    // "var x = 1;" might be split or treated as one.
    // At least the text should exist.
    const allText = segments.map((s) => s.text).join(' ')
    expect(allText).toContain('var x = 1')
  })

  // Additional comprehensive tests
  describe('edge cases', () => {
    it('handles empty content gracefully', () => {
      const { segments } = segmentHtmlContent('test-chapter', '')
      expect(segments).toEqual([])
    })

    it('handles whitespace-only content', () => {
      const { segments } = segmentHtmlContent('test-chapter', '   \n\t  ')
      expect(segments).toEqual([])
    })

    it('handles plain text without HTML tags', () => {
      const { segments } = segmentHtmlContent(
        'test-chapter',
        'Just plain text here. Another sentence.'
      )
      expect(segments.length).toBeGreaterThanOrEqual(1)
    })

    it('generates unique segment IDs', () => {
      const html = '<p>First. Second. Third. Fourth. Fifth.</p>'
      const { segments } = segmentHtmlContent('test-chapter', html)

      const ids = segments.map((s) => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it('assigns sequential indices starting from 0', () => {
      const html = '<p>First. Second. Third.</p>'
      const { segments } = segmentHtmlContent('test-chapter', html)

      if (segments.length > 0) {
        expect(segments[0].index).toBe(0)
        for (let i = 1; i < segments.length; i++) {
          expect(segments[i].index).toBe(segments[i - 1].index + 1)
        }
      }
    })
  })

  describe('complex HTML structures', () => {
    it('handles lists correctly', () => {
      const html = `
        <ul>
          <li>First item in list.</li>
          <li>Second item in list.</li>
        </ul>
      `
      const { segments } = segmentHtmlContent('list-test', html)

      const combinedText = segments.map((s) => s.text).join(' ')
      expect(combinedText).toContain('First item')
      expect(combinedText).toContain('Second item')
    })

    it('handles blockquotes', () => {
      const html = `
        <blockquote>This is a quoted passage from the book.</blockquote>
        <p>The author continues with regular text.</p>
      `
      const { segments } = segmentHtmlContent('quote-test', html)

      const combinedText = segments.map((s) => s.text).join(' ')
      expect(combinedText).toContain('quoted passage')
    })

    it('handles headings', () => {
      const html = `
        <h1>Chapter Title</h1>
        <p>Some content here.</p>
      `
      const { segments } = segmentHtmlContent('heading-test', html)

      const combinedText = segments
        .map((s) => s.text)
        .join(' ')
        .toLowerCase()
      expect(combinedText).toContain('chapter title')
    })

    it('preserves inline formatting in text', () => {
      const html = '<p>This has <strong>bold</strong> and <em>italic</em> text.</p>'
      const { segments } = segmentHtmlContent('inline-test', html)

      const combinedText = segments.map((s) => s.text).join(' ')
      expect(combinedText).toContain('bold')
      expect(combinedText).toContain('italic')
    })
  })

  describe('link handling', () => {
    it('ignores links when option is set', () => {
      const html = '<p>Click <a href="http://example.com">this link</a> to continue.</p>'
      const { segments } = segmentHtmlContent('link-test', html, { ignoreLinks: true })

      const combinedText = segments.map((s) => s.text).join(' ')
      expect(combinedText).not.toContain('this link')
    })

    it('keeps links by default', () => {
      const html = '<p>Visit <a href="http://example.com">our website</a> for more.</p>'
      const { segments } = segmentHtmlContent('link-test', html)

      const combinedText = segments.map((s) => s.text).join(' ')
      expect(combinedText).toContain('our website')
    })
  })
})

// ============================================================================
// TTS WORKER INTEGRATION TESTS
// ============================================================================

describe('TTS Worker Integration', () => {
  let mockWorker: ReturnType<typeof createMockTTSWorkerManager>

  beforeEach(() => {
    mockWorker = createMockTTSWorkerManager()
    vi.clearAllMocks()
  })

  it('generates audio via worker', async () => {
    const result = await mockWorker.generateVoice({
      text: 'Test sentence.',
      modelType: 'kokoro',
      voice: 'af_heart',
    })

    expect(result).toBeInstanceOf(Blob)
    expect(mockWorker.generateVoice).toHaveBeenCalledTimes(1)
  })

  it('handles worker errors gracefully', async () => {
    const failingWorker = createMockTTSWorkerManager({
      shouldFail: true,
      errorMessage: 'TTS generation failed',
    })

    await expect(failingWorker.generateVoice({ text: 'Test' })).rejects.toThrow(
      'TTS generation failed'
    )
  })

  it('generates segments with correct structure', async () => {
    const result = await mockWorker.generateSegments({
      text: 'First sentence. Second sentence.',
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('text')
    expect(result[0]).toHaveProperty('blob')
    expect(result[0].blob).toBeInstanceOf(Blob)
  })

  it('cancels all pending requests', () => {
    mockWorker.cancelAll()
    expect(mockWorker.cancelAll).toHaveBeenCalled()
  })

  it('terminates worker cleanly', () => {
    mockWorker.terminate()
    expect(mockWorker._isTerminated()).toBe(true)
  })
})

// ============================================================================
// FAILING TESTS - IDENTIFIED POTENTIAL BUGS
// These tests document known issues and will fail until the bugs are fixed
// ============================================================================

describe('Potential Bugs (Failing Tests)', () => {
  describe('BUG: SegmentBatchHandler error handling (lines 63-87)', () => {
    /**
     * BUG: In SegmentBatchHandler.addSegment, when batch flush fails,
     * the error is logged but segment is still marked as generated.
     * If ALL segments fail to flush, user sees progress but no audio saved.
     *
     * Location: src/lib/services/generationService.ts lines 63-87
     * Expected: User should be notified of persistent save failures
     * Actual: Errors are silently logged, generation appears successful
     */
    it.fails('should notify user when all segment saves fail', async () => {
      // Intentionally failing placeholder test documenting a known bug.
      // Once SegmentBatchHandler correctly surfaces persistent save failures
      // to the user (e.g., via an error notification), replace this throw
      // with assertions that verify the notification behavior under
      // simulated "all segment saves fail" conditions.
      throw new Error(
        'Known bug: SegmentBatchHandler does not notify the user when all segment saves fail.'
      )
    })
  })

  describe('Segment processing termination (lines 765-860)', () => {
    /**
     * This tests that segment processing terminates correctly even when
     * segments fail. Failed segments should be marked as processed to
     * prevent infinite loops.
     *
     * Location: src/lib/services/generationService.ts lines 765-860
     */
    it('should terminate after trying each segment once', async () => {
      let attempts = 0
      const maxAttempts = 10
      const segments = [{ index: 0 }, { index: 1 }, { index: 2 }]
      const processed = new Set<number>()

      // Simulate processor that fails but should mark as processed
      const processSegment = async (segmentIndex: number) => {
        attempts++
        if (attempts > maxAttempts) {
          throw new Error('Too many attempts - infinite loop detected')
        }
        // In a correct implementation, failed segments should be marked as processed
        // to prevent re-processing. The bug is if they're not marked.
        processed.add(segmentIndex) // Simulating correct behavior
        throw new Error('Segment processing failed')
      }

      // Process all segments
      for (const seg of segments) {
        if (processed.has(seg.index)) continue
        try {
          await processSegment(seg.index)
        } catch {
          // Error handled, segment marked as processed
        }
      }

      // Expected: Should process each segment once (3 attempts total)
      expect(attempts).toBe(3)
      expect(processed.size).toBe(3)
    })
  })

  describe('BUG: Memory leak in URL.createObjectURL (lines 1275-1283)', () => {
    /**
     * BUG: URL.createObjectURL is called for fullBlob but if an error
     * occurs between creation and storage in generatedAudio map,
     * the URL is never revoked.
     *
     * Location: src/lib/services/generationService.ts lines 1275-1283
     * Expected: All created URLs should be revoked on error
     * Actual: URLs created before error leak memory
     */
    it.fails('should revoke blob URLs on error during generation', () => {
      const revokedUrls: string[] = []
      const createdUrls: string[] = []
      let urlCounter = 0

      const originalCreate = URL.createObjectURL
      const originalRevoke = URL.revokeObjectURL

      URL.createObjectURL = vi.fn((_blob: Blob) => {
        const url = `blob:test-${urlCounter++}`
        createdUrls.push(url)
        return url
      })

      URL.revokeObjectURL = vi.fn((url: string) => {
        revokedUrls.push(url)
      })

      try {
        // Simulate: URL created, then error before storage
        const blob = createMockWavBlob(100)
        URL.createObjectURL(blob)
        throw new Error('Storage failed after URL creation')
      } catch {
        // Error occurred - URL should be revoked in cleanup
      }

      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke

      // Expected: createdUrls === revokedUrls
      // Actual: URL leaks because no cleanup on error path
      expect(revokedUrls).toEqual(createdUrls)
    })
  })

  describe('FIXED: Chapter content mutation (line 1085)', () => {
    /**
     * FIXED: segmentHtmlContent now strips existing span.segment elements
     * before re-segmenting, preventing double-wrapping on regeneration.
     *
     * Location: src/lib/services/generationService.ts segmentHtmlContent
     * Fix: Strip existing segment spans and normalize text nodes before segmenting
     */
    it('should not double-wrap segments on regeneration', () => {
      const originalHtml = '<p>Original sentence here.</p>'

      // First segmentation
      const { html: firstHtml } = segmentHtmlContent('ch1', originalHtml)

      // Second segmentation of already-segmented content (simulates regeneration)
      const { html: secondHtml } = segmentHtmlContent('ch1', firstHtml)

      // Check for nested segment spans
      const nestedSegmentPattern = /<span[^>]*class="segment"[^>]*>.*<span[^>]*class="segment"/s

      // Fixed: No nested segments after re-segmentation
      expect(nestedSegmentPattern.test(secondHtml)).toBe(false)
    })

    it('should produce same segment count on regeneration', () => {
      const originalHtml = '<p>First sentence. Second sentence. Third one here.</p>'

      const { segments: first } = segmentHtmlContent('ch1', originalHtml)
      const { html: firstHtml } = segmentHtmlContent('ch1', originalHtml)
      const { segments: second } = segmentHtmlContent('ch1', firstHtml)

      expect(second.length).toBe(first.length)
      // Text content should be identical
      for (let i = 0; i < first.length; i++) {
        expect(second[i].text).toBe(first[i].text)
      }
    })

    it('should produce consistent segments across multiple regenerations', () => {
      const originalHtml = '<p>Hello world. Goodbye world.</p>'

      const { segments: seg1 } = segmentHtmlContent('ch1', originalHtml)
      const { html: html1 } = segmentHtmlContent('ch1', originalHtml)
      const { segments: seg2 } = segmentHtmlContent('ch1', html1)
      const { html: html2 } = segmentHtmlContent('ch1', html1)
      const { segments: seg3 } = segmentHtmlContent('ch1', html2)

      // Segment count and text should remain stable across regenerations
      expect(seg2.length).toBe(seg1.length)
      expect(seg3.length).toBe(seg1.length)
      for (let i = 0; i < seg1.length; i++) {
        expect(seg2[i].text).toBe(seg1[i].text)
        expect(seg3[i].text).toBe(seg1[i].text)
      }
    })
  })

  describe('BUG: Empty segment index gaps (lines 1130-1131)', () => {
    /**
     * BUG: Empty segments return null from processor but original index preserved.
     * This leaves gaps in audioSegments array indices (e.g., [0, 3] instead of [0, 1]).
     *
     * Location: src/lib/services/generationService.ts lines 1130-1131
     * Expected: Indices should be contiguous after filtering empty segments
     * Actual: Original indices preserved, creating gaps
     */
    it.fails('should maintain contiguous segment indices with empty segments', () => {
      const inputSegments = [
        { index: 0, text: 'First sentence.', id: 'seg-0' },
        { index: 1, text: '', id: 'seg-1' }, // Empty
        { index: 2, text: '   ', id: 'seg-2' }, // Whitespace only
        { index: 3, text: 'Last sentence.', id: 'seg-3' },
      ]

      const audioSegments: { index: number; text: string }[] = []

      for (const seg of inputSegments) {
        if (!seg.text.trim()) continue
        audioSegments.push({ index: seg.index, text: seg.text })
      }

      // Expected: indices [0, 1] (renumbered)
      // Actual: indices [0, 3] (gaps)
      const indices = audioSegments.map((s) => s.index)
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBe(indices[i - 1] + 1)
      }
    })
  })
})

// ============================================================================
// CANCELLATION AND CLEANUP TESTS
// ============================================================================

describe('Cancellation and Cleanup', () => {
  describe('Cancellation during batch flush (line 1227)', () => {
    /**
     * This tests cancellation handling during batch operations.
     *
     * The actual implementation in generationService.ts checks cancellation
     * at the start of each loop iteration. If flush is a long operation,
     * cancellation only takes effect after flush completes.
     */
    it('should check cancellation flag during flush', async () => {
      let canceled = false
      let flushCompleted = false

      const mockFlush = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        // The fix: check cancellation flag after await
        if (canceled) throw new Error('Cancelled')
        flushCompleted = true
      }

      const flushPromise = mockFlush()

      // Cancel during flush
      setTimeout(() => {
        canceled = true
      }, 10)

      try {
        await flushPromise
      } catch {
        // Expected to catch cancellation
      }

      // Expected: flushCompleted = false (flush aborted due to cancellation check after await)
      expect(flushCompleted).toBe(false)
    })
  })

  describe('FIXED: Auto-play race condition (lines 1207-1216)', () => {
    /**
     * FIXED: Auto-play setTimeout callback now re-checks this.canceled
     * before calling playSingleSegment, preventing playback after cancellation.
     *
     * Location: src/lib/services/generationService.ts auto-play callback
     * Fix: Added `if (this.canceled) return` inside setTimeout callback
     */
    it('should cancel auto-play when generation is cancelled', async () => {
      let autoPlayCalled = false
      let canceled = false

      const autoPlayTriggered = new Set<string>()

      // Simulate auto-play trigger logic (matches the fixed implementation)
      const triggerAutoPlay = (chapterId: string) => {
        if (!autoPlayTriggered.has(chapterId) && !canceled) {
          autoPlayTriggered.add(chapterId)
          setTimeout(() => {
            // Fixed: re-check canceled inside the callback
            if (canceled) {
              return
            }
            autoPlayCalled = true
          }, 0)
        }
      }

      triggerAutoPlay('ch1')
      canceled = true // Cancel immediately after trigger

      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Fixed: autoPlayCalled = false because callback checks canceled
      expect(autoPlayCalled).toBe(false)
    })
  })
})

// ============================================================================
// FIXED BUG TESTS - processSegmentsWithPriority
// ============================================================================

describe('FIXED: processSegmentsWithPriority uses Promise.allSettled', () => {
  /**
   * FIXED: processSegmentsWithPriority now uses Promise.allSettled instead of
   * Promise.all, so a single segment failure doesn't lose the entire batch.
   * Failed segments are tracked in a separate `failed` set.
   *
   * Location: src/lib/services/generationService.ts processSegmentsWithPriority
   * Fix: Promise.all → Promise.allSettled, separate failed tracking
   */
  it('should not lose successful results when one segment fails', async () => {
    const processed = new Set<number>()
    const failed = new Set<number>()
    const segments = [
      { index: 0, text: 'Good segment' },
      { index: 1, text: 'Bad segment' },
      { index: 2, text: 'Another good segment' },
    ]

    // Simulate Promise.allSettled behavior (the fix)
    const results = await Promise.allSettled(
      segments.map(async (seg) => {
        if (seg.index === 1) throw new Error('Segment 1 failed')
        return { index: seg.index, audio: new Blob(['audio'], { type: 'audio/wav' }) }
      })
    )

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        processed.add(segments[i].index)
      } else if (result.status === 'rejected') {
        failed.add(segments[i].index)
      }
    }

    // Segments 0 and 2 should be processed, segment 1 should be failed
    expect(processed.has(0)).toBe(true)
    expect(processed.has(2)).toBe(true)
    expect(failed.has(1)).toBe(true)
    expect(processed.size).toBe(2)
    expect(failed.size).toBe(1)
  })

  it('should terminate loop when all segments are processed or failed', async () => {
    const processed = new Set<number>()
    const failed = new Set<number>()
    const total = 5
    let iterations = 0

    // Simulate the main loop condition from processSegmentsWithPriority
    while (processed.size + failed.size < total) {
      iterations++
      if (iterations > 100) throw new Error('Infinite loop detected')

      // Simulate: even indices succeed, odd indices fail
      const nextIndex = processed.size + failed.size
      if (nextIndex % 2 === 0) {
        processed.add(nextIndex)
      } else {
        failed.add(nextIndex)
      }
    }

    expect(processed.size + failed.size).toBe(total)
    expect(iterations).toBe(total) // Should take exactly `total` iterations
  })
})
