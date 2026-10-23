// PROTOTYPE (throwaway): pure segment-timing math, split out of the runes-based
// simulation so it can be unit tested (vitest runs no Svelte compiler here).
export type SegmentGenState = 'pending' | 'generating' | 'generated'

/** Which segment is being spoken at a position (0..1 of the chapter). */
export function segmentIndexAt(weights: number[], fraction: number): number {
  if (weights.length === 0) return -1
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const frac = Math.min(0.9999, Math.max(0, fraction))
  let acc = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total
    if (frac < acc) return i
  }
  return weights.length - 1
}

/** Fraction (0..1) of a chapter where a segment starts, by weight. */
export function segmentStartFraction(weights: number[], index: number): number {
  if (weights.length === 0) return 0
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  for (let i = 0; i < Math.min(index, weights.length); i++) acc += weights[i]
  return acc / total
}

/** How many segments of a chapter have been generated at progress (0..1). */
export function processedCount(count: number, progress: number, ready: boolean): number {
  return ready ? count : Math.floor(progress * count)
}

/** Generation state of one segment given how far generation has moved. */
export function segmentStateAt(
  index: number,
  processed: number,
  generating: boolean
): SegmentGenState {
  if (index < processed) return 'generated'
  if (generating && index === processed) return 'generating'
  return 'pending'
}
