import { describe, expect, it, vi } from 'vitest'

// Mock the audioPlaybackService to avoid Svelte runes error
vi.mock('../src/lib/audioPlaybackService.svelte', () => ({
  audioService: {
    stop: vi.fn(),
    loadChapter: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    playFromSegment: vi.fn(),
  },
}))

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

    // html-to-text uppercases headings, so we just check for content presence
    expect(combined).toContain('useful link')
    expect(combined).toContain('important code sample')
    expect(combined).toContain('Closing thoughts')
    expect(combined.toLowerCase()).toContain('chapter title')
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

    // When ignoreLinks is true, the link elements and their text are removed
    expect(combined).not.toContain('useful link')
    expect(combined).not.toContain('reference')
    // Surrounding text is preserved (note: articles like "a" remain)
    expect(combined).toContain('Intro paragraph with a inside')
    expect(combined).toContain('important code sample')
  })

  it('preserves all content from structured HTML with multiple paragraphs', () => {
    const structuredHtml = `
      <article>
        <h1>Article Title</h1>
        <p>First paragraph with some important content.</p>
        <p>Second paragraph with more details.</p>
        <p>Third paragraph concluding the article.</p>
        <h2>Section Heading</h2>
        <p>Fourth paragraph in a new section.</p>
        <p>Fifth paragraph with final thoughts.</p>
      </article>
    `

    const { segments } = segmentHtmlContent('article-1', structuredHtml)
    const combined = normalize(segments.map((s) => s.text).join(' '))

    // Verify all content is preserved (html-to-text uppercases headings)
    expect(combined.toLowerCase()).toContain('article title')
    expect(combined).toContain('First paragraph with some important content')
    expect(combined).toContain('Second paragraph with more details')
    expect(combined).toContain('Third paragraph concluding the article')
    expect(combined.toLowerCase()).toContain('section heading')
    expect(combined).toContain('Fourth paragraph in a new section')
    expect(combined).toContain('Fifth paragraph with final thoughts')

    // Verify we have multiple segments (not just one big chunk)
    expect(segments.length).toBeGreaterThan(1)
  })

  it('segments plain text content without HTML structure less effectively', () => {
    // Simulate what happens when textContent is used instead of HTML content
    const plainText = `Article Title First paragraph with some important content. Second paragraph with more details. Third paragraph concluding the article. Section Heading Fourth paragraph in a new section. Fifth paragraph with final thoughts.`

    // When plain text is passed as if it were HTML, segmentation still works but loses structure
    const { segments } = segmentHtmlContent('article-2', plainText)
    const combined = normalize(segments.map((s) => s.text).join(' '))

    // Content is preserved
    expect(combined).toContain('Article Title')
    expect(combined).toContain('First paragraph with some important content')

    // But with proper HTML, we'd get better segmentation
    // This test documents the current behavior
    expect(segments.length).toBeGreaterThan(0)
  })
})
