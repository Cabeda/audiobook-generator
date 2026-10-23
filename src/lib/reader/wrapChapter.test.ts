// Specification for lazy, cached chapter wrapping (large books must wrap
// each chapter once, when it is first shown).
import { describe, expect, it } from 'vitest'
import { createChapterWrapper } from './wrapChapter'

describe('createChapterWrapper', () => {
  it('wraps a chapter once and serves the rest from cache', () => {
    const wrap = createChapterWrapper()
    const first = wrap('c1', '<p>One sentence here.</p>')
    const second = wrap('c1', '<p>One sentence here.</p>')

    expect(first).toBe(second)
    expect(first.segments.length).toBeGreaterThan(0)
    expect(first.html).toContain('segment')
  })

  it('wraps chapters independently', () => {
    const wrap = createChapterWrapper()
    const a = wrap('c1', '<p>Alpha.</p>')
    const b = wrap('c2', '<p>Beta.</p>')

    expect(a).not.toBe(b)
    expect(b.segments[0].text).toContain('Beta')
  })
})
