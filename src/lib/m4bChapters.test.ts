import { describe, it, expect } from 'vitest'
import { injectChapterMarkers, type ChapterMarker } from './m4bChapters'

/**
 * Test for M4B chapter marker injection (issue #157)
 */
describe('m4bChapters', () => {
  // Create a minimal valid MP4 with just ftyp + moov atoms
  function createMinimalMp4(): Blob {
    const buf = new Uint8Array(28)
    const view = new DataView(buf.buffer)
    // ftyp atom (20 bytes)
    view.setUint32(0, 20) // size
    buf.set(new TextEncoder().encode('ftyp'), 4)
    buf.set(new TextEncoder().encode('M4A '), 8)
    // moov atom (8 bytes, empty)
    view.setUint32(20, 8) // size
    buf.set(new TextEncoder().encode('moov'), 24)
    return new Blob([buf], { type: 'audio/m4b' })
  }

  it('should inject chapter markers into M4B', async () => {
    const m4b = createMinimalMp4()
    const chapters: ChapterMarker[] = [
      { title: 'Chapter 1', startTimeMs: 0 },
      { title: 'Chapter 2', startTimeMs: 60000 },
      { title: 'Chapter 3', startTimeMs: 120000 },
    ]

    const result = await injectChapterMarkers(m4b, chapters)

    // Result should be larger than input (markers added)
    expect(result.size).toBeGreaterThan(m4b.size)

    // Verify the result contains 'chpl' and 'udta' atoms
    const data = new Uint8Array(await result.arrayBuffer())
    const text = new TextDecoder().decode(data)
    expect(text).toContain('udta')
    expect(text).toContain('chpl')
    // Verify chapter titles are in the output
    expect(text).toContain('Chapter 1')
    expect(text).toContain('Chapter 2')
    expect(text).toContain('Chapter 3')
  })

  it('should return unchanged blob when no chapters provided', async () => {
    const m4b = createMinimalMp4()
    const result = await injectChapterMarkers(m4b, [])
    expect(result.size).toBe(m4b.size)
  })

  it('should handle missing moov atom gracefully', async () => {
    const noMoov = new Blob([new Uint8Array(100)], { type: 'audio/m4b' })
    const chapters: ChapterMarker[] = [{ title: 'Ch1', startTimeMs: 0 }]
    const result = await injectChapterMarkers(noMoov, chapters)
    // Should return unchanged
    expect(result.size).toBe(noMoov.size)
  })

  it('should truncate titles longer than 255 bytes', async () => {
    const m4b = createMinimalMp4()
    const longTitle = 'A'.repeat(300)
    const chapters: ChapterMarker[] = [{ title: longTitle, startTimeMs: 0 }]

    const result = await injectChapterMarkers(m4b, chapters)
    const data = new Uint8Array(await result.arrayBuffer())
    const text = new TextDecoder().decode(data)

    // Title should be truncated to 255 chars
    expect(text).not.toContain(longTitle)
    expect(text).toContain('A'.repeat(255))
  })
})
