import { describe, it, expect } from 'vitest'
import {
  applySegmentState,
  findSegmentElement,
  getSegmentIndex,
  highlightActiveSegment,
  scrollSegmentIntoView,
  segmentIndexFromEvent,
  segmentStateFor,
} from './readerSegments'

function makeSegment(id: string): HTMLElement {
  const element = document.createElement('span')
  element.id = id
  element.className = 'segment'
  return element
}

describe('reader segments', () => {
  it('reads the index from a segment element', () => {
    expect(getSegmentIndex(makeSegment('seg-0'))).toBe(0)
    expect(getSegmentIndex(makeSegment('seg-42'))).toBe(42)
  })

  it('ignores elements that are not segments', () => {
    expect(getSegmentIndex(null)).toBeNull()
    expect(getSegmentIndex(makeSegment('other'))).toBeNull()
    expect(getSegmentIndex(makeSegment('seg-x'))).toBeNull()
  })

  it('finds a segment inside a container', () => {
    const root = document.createElement('div')
    const segment = makeSegment('seg-3')
    root.appendChild(segment)

    expect(findSegmentElement(3, root)).toBe(segment)
    expect(findSegmentElement(4, root)).toBeNull()
  })

  it('marks one segment active and clears the others', () => {
    const first = makeSegment('seg-0')
    const second = makeSegment('seg-1')
    document.body.append(first, second)

    highlightActiveSegment(1)

    expect(first.classList.contains('active')).toBe(false)
    expect(second.classList.contains('active')).toBe(true)

    first.remove()
    second.remove()
  })

  it('derives the state of a segment from the generation progress', () => {
    const progress = { generatedIndices: new Set([1]), isGenerating: true, processingIndex: 2 }

    expect(segmentStateFor(1, progress)).toBe('generated')
    expect(segmentStateFor(2, progress)).toBe('generating')
    expect(segmentStateFor(3, progress)).toBe('pending')
  })

  it('draws a segment in one state at a time', () => {
    const segment = makeSegment('seg-0')
    applySegmentState(segment, 'generating')
    expect(segment.classList.contains('segment-generating')).toBe(true)

    applySegmentState(segment, 'generated')
    expect(segment.classList.contains('segment-generating')).toBe(false)
    expect(segment.classList.contains('segment-generated')).toBe(true)
  })

  it('finds the segment an event landed on', () => {
    const segment = makeSegment('seg-5')
    const child = document.createElement('em')
    segment.appendChild(child)

    const event = { target: child } as unknown as Event
    expect(segmentIndexFromEvent(event)).toBe(5)
  })

  it('scrolls a segment that is outside the band', () => {
    const segment = makeSegment('seg-0')
    document.body.appendChild(segment)
    let scrolled = false
    segment.scrollIntoView = () => {
      scrolled = true
    }

    segment.getBoundingClientRect = () => ({ top: 500, bottom: 560 }) as DOMRect

    scrollSegmentIntoView(segment, { top: 100, bottom: 400 })
    expect(scrolled).toBe(true)

    scrolled = false
    segment.getBoundingClientRect = () => ({ top: 150, bottom: 200 }) as DOMRect
    scrollSegmentIntoView(segment, { top: 100, bottom: 400 })
    expect(scrolled).toBe(false)

    segment.remove()
  })
})
