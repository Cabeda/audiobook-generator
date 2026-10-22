// PROTOTYPE: checks for the segment-timing math used by the audio simulation.
import { describe, expect, it } from 'vitest'
import { processedCount, segmentIndexAt, segmentStartFraction, segmentStateAt } from './segmentMath'

describe('segmentMath', () => {
  it('maps a position to the segment being spoken, weighted by length', () => {
    const weights = [4, 2] // segments take 4/6 and 2/6 of the chapter
    expect(segmentIndexAt(weights, 0)).toBe(0)
    expect(segmentIndexAt(weights, 0.5)).toBe(0) // below 0.667
    expect(segmentIndexAt(weights, 0.8)).toBe(1)
    expect(segmentIndexAt(weights, 1)).toBe(1) // clamps to the last segment
    expect(segmentIndexAt([], 0.5)).toBe(-1)
  })

  it('maps a segment back to where it starts', () => {
    const weights = [4, 2]
    expect(segmentStartFraction(weights, 0)).toBe(0)
    expect(segmentStartFraction(weights, 1)).toBeCloseTo(4 / 6)
    expect(segmentStartFraction(weights, 9)).toBe(1) // past the end clamps to the end
    expect(segmentStartFraction([], 2)).toBe(0)
  })

  it('counts generated segments from chapter progress', () => {
    expect(processedCount(4, 0.5, false)).toBe(2)
    expect(processedCount(4, 0, false)).toBe(0)
    expect(processedCount(4, 0.5, true)).toBe(4) // a ready chapter is fully generated
  })

  it('reports generation state per segment', () => {
    // 2 of 4 processed, currently generating
    expect(segmentStateAt(0, 2, true)).toBe('generated')
    expect(segmentStateAt(1, 2, true)).toBe('generated')
    expect(segmentStateAt(2, 2, true)).toBe('generating')
    expect(segmentStateAt(3, 2, true)).toBe('pending')
    // nothing queued yet: everything pending
    expect(segmentStateAt(0, 0, false)).toBe('pending')
  })
})
