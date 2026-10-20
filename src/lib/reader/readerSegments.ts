/**
 * Reader segments.
 *
 * The behaviour both readers share: finding the segment under the pointer,
 * marking the one that is playing, showing which segments have been generated
 * and scrolling to the segment that is playing.
 *
 * The readers differ in where they look for a segment — one chapter at a time
 * or a whole book at once — so every lookup takes the container to look in.
 */

export const SEGMENT_CLASS = 'segment'
export const SEGMENT_ID_PREFIX = 'seg-'

/** The index of the segment an element belongs to, or null when it is not one. */
export function getSegmentIndex(element: HTMLElement | null): number | null {
  if (!element || !element.id.startsWith(SEGMENT_ID_PREFIX)) return null
  const index = parseInt(element.id.slice(SEGMENT_ID_PREFIX.length), 10)
  return isNaN(index) ? null : index
}

/** The element of a segment, looked up in a container when one is given. */
export function findSegmentElement(index: number, root?: ParentNode | null): HTMLElement | null {
  if (!root) return document.getElementById(`${SEGMENT_ID_PREFIX}${index}`)
  return root.querySelector(`#${SEGMENT_ID_PREFIX}${index}`) as HTMLElement | null
}

/** Mark one segment as the active one and clear the others. */
export function highlightActiveSegment(index: number, root?: ParentNode | null): void {
  document
    .querySelectorAll(`.${SEGMENT_CLASS}.active`)
    .forEach((element) => element.classList.remove('active'))
  findSegmentElement(index, root)?.classList.add('active')
}

/** How a segment is drawn: generated, being generated, or still pending. */
export type SegmentState = 'pending' | 'generated' | 'generating'

/** The state of a segment, from the generation progress of its chapter. */
export function segmentStateFor(
  index: number,
  progress: { generatedIndices: Set<number>; isGenerating: boolean; processingIndex: number }
): SegmentState {
  if (progress.generatedIndices.has(index)) return 'generated'
  if (progress.isGenerating && index === progress.processingIndex) return 'generating'
  return 'pending'
}

/** Draw a segment in the state it is in. */
export function applySegmentState(element: HTMLElement, state: SegmentState): void {
  element.classList.remove('segment-pending', 'segment-generated', 'segment-generating')
  element.classList.add(`segment-${state}`)
}

/**
 * Scroll a segment into view when it is outside the given band.
 *
 * The band is given in viewport coordinates, so a reader that scrolls an inner
 * container can pass the container's edges.
 */
export function scrollSegmentIntoView(
  element: HTMLElement,
  band: { top: number; bottom: number; behavior?: ScrollBehavior }
): void {
  const rect = element.getBoundingClientRect()
  if (rect.top < band.top || rect.bottom > band.bottom) {
    element.scrollIntoView({ behavior: band.behavior ?? 'smooth', block: 'center' })
  }
}

/** The segment an event landed on, or null. */
export function segmentIndexFromEvent(event: Event): number | null {
  const target = event.target as HTMLElement | null
  if (!target) return null
  const segmentElement = target.closest(`.${SEGMENT_CLASS}`) as HTMLElement | null
  return getSegmentIndex(segmentElement)
}
