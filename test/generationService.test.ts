import { describe, expect, it } from 'vitest'
import { segmentHtmlContent } from '../src/lib/services/generationService'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const sampleHtml = `
  <h1>Chapter Title</h1>
  <p>Intro paragraph with a <a href="https://example.com">useful link</a> inside.</p>
  <pre><code>const answer = 42; // important code sample</code></pre>
  <p>Closing thoughts with another <a href="https://example.org">reference</a>.</p>
`

describe('segmentHtmlContent', () => {
  it('keeps the full text by default (links and code included)', () => {
    const { segments } = segmentHtmlContent('ch-1', sampleHtml)
    const combined = normalize(segments.map((s) => s.text).join(' '))

    const expected = normalize(
      new DOMParser().parseFromString(sampleHtml, 'text/html').body.textContent || ''
    )

    expect(combined).toContain('useful link')
    expect(combined).toContain('important code sample')
    expect(combined).toContain('Closing thoughts')
    expect(combined).toBe(expected)
  })

  it('can skip code blocks when requested', () => {
    const { segments } = segmentHtmlContent('ch-1', sampleHtml, { ignoreCodeBlocks: true })
    const combined = normalize(segments.map((s) => s.text).join(' '))

    expect(combined).not.toContain('important code sample')
    expect(combined).toContain('useful link')
  })

  it('can skip link text when requested', () => {
    const { segments } = segmentHtmlContent('ch-1', sampleHtml, { ignoreLinks: true })
    const combined = normalize(segments.map((s) => s.text).join(' '))

    expect(combined).not.toContain('useful link')
    expect(combined).not.toContain('reference')
    expect(combined).toContain('important code sample')
  })
})
