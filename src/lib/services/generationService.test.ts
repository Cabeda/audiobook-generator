import { describe, it, expect } from 'vitest'
import { segmentHtmlContent } from './generationService'

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
})
