import { describe, it, expect } from 'vitest'
import { segmentHtmlContent } from './segmentationService'

describe('segmentHtmlContent', () => {
  it('reads a table a row at a time, header row included', () => {
    const { html, segments } = segmentHtmlContent(
      'chapter-1',
      '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Bob</td><td>42</td></tr></table>'
    )

    expect(segments.map((segment) => segment.text)).toEqual(['Name, Age', 'Bob, 42'])
    expect(html).toContain('data-segment-index="1"')
    // The id sits on the first cell only; the row is found by the index.
    expect(html.match(/id="seg-1"/g)).toHaveLength(1)
    expect(html.match(/data-segment-index="1"/g)).toHaveLength(2)
  })

  it('speaks an image by its alt text when it stands alone', () => {
    const { segments } = segmentHtmlContent(
      'chapter-1',
      '<figure><img src="chart.png" alt="A chart of sales"></figure>'
    )

    expect(segments.map((segment) => segment.text)).toEqual(['A chart of sales'])
  })

  it('prefers a caption over the alt text', () => {
    const { segments } = segmentHtmlContent(
      'chapter-1',
      '<figure><img src="chart.png" alt="A chart"><figcaption>Sales by quarter</figcaption></figure>'
    )

    expect(segments.map((segment) => segment.text)).toEqual(['Sales by quarter'])
  })

  it('keeps lists and headings as their own segments', () => {
    const { segments } = segmentHtmlContent(
      'chapter-1',
      '<h2>Steps</h2><ul><li>First step.</li><li>Second step.</li></ul>'
    )

    expect(segments.map((segment) => segment.text)).toEqual([
      'Steps',
      'First step.',
      'Second step.',
    ])
  })
})
