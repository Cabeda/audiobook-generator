import { describe, it, expect } from 'vitest'
import { segmentId, createSegment } from './segments'
import { segmentHtmlContent } from './services/segmentationService'

describe('segment module', () => {
  it('gives a segment the same id everywhere', () => {
    expect(segmentId(0)).toBe('seg-0')
    expect(segmentId(12)).toBe('seg-12')

    const segment = createSegment({
      chapterId: 'ch1',
      index: 3,
      text: 'Hello.',
      audioBlob: new Blob([new Uint8Array(4)]),
    })
    expect(segment.id).toBe('seg-3')
    expect(segment.chapterId).toBe('ch1')
    expect(segment.index).toBe(3)
    expect(segment.duration).toBe(0)
    expect(segment.startTime).toBe(0)
  })

  it('keeps the optional fields off the record when they are not given', () => {
    const segment = createSegment({
      chapterId: 'ch1',
      index: 0,
      text: 'Hello.',
      audioBlob: new Blob([new Uint8Array(4)]),
    })
    expect('qualityTier' in segment).toBe(false)
    expect('voice' in segment).toBe(false)
    expect('model' in segment).toBe(false)
  })

  // The EPUB export only emits a SMIL paragraph when the segment id is present
  // in the chapter's XHTML. That holds only if both sides mint ids the same way.
  it('mints ids that the segmented content actually contains', () => {
    const { html, segments } = segmentHtmlContent(
      'ch1',
      '<p>The first sentence. The second sentence. The third sentence.</p>'
    )

    expect(segments.length).toBeGreaterThan(1)

    for (const segment of segments) {
      const record = createSegment({
        chapterId: 'ch1',
        index: segment.index,
        text: segment.text,
        audioBlob: new Blob([new Uint8Array(4)]),
      })
      expect(html).toContain(`id="${record.id}"`)
    }
  })
})
