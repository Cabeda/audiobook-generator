import { describe, expect, it } from 'vitest'
import { Readability } from '@mozilla/readability'
import { segmentHtmlContent } from '../src/lib/services/generationService'

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

describe('Article Parsing Integration', () => {
  it('preserves all content when using article.content (HTML) from Readability', () => {
    // Simulate a real article HTML that would be fetched from a URL
    const articleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sample Article</title>
          <meta name="author" content="John Doe">
        </head>
        <body>
          <article>
            <h1>The Future of Technology</h1>
            <p>Technology is advancing at an unprecedented pace. From artificial intelligence to quantum computing, the innovations we see today will shape tomorrow.</p>
            <p>The impact of these technologies spans multiple sectors. Healthcare, education, and finance are all being transformed by digital innovation.</p>
            <h2>Artificial Intelligence</h2>
            <p>AI is no longer science fiction. It's becoming an integral part of our daily lives, powering everything from virtual assistants to autonomous vehicles.</p>
            <p>Machine learning algorithms can now analyze vast amounts of data, uncovering patterns that humans might miss. This capability is revolutionizing fields like medicine and climate science.</p>
            <h2>Quantum Computing</h2>
            <p>Quantum computers leverage the principles of quantum mechanics to solve problems that are currently intractable for classical computers.</p>
            <p>While still in early stages, quantum computing promises breakthroughs in cryptography, drug discovery, and optimization problems.</p>
            <h2>Conclusion</h2>
            <p>The convergence of these technologies will create unprecedented opportunities. However, we must also address the ethical implications and ensure equitable access.</p>
            <p>As we move forward, collaboration between technologists, policymakers, and society at large will be essential to harness these advances for the common good.</p>
          </article>
          <div class="sidebar">
            <p>Advertisement content</p>
          </div>
          <footer>
            <p>Copyright 2025</p>
          </footer>
        </body>
      </html>
    `

    // Parse with Readability (like we do in UnifiedInput.svelte)
    const parser = new DOMParser()
    const doc = parser.parseFromString(articleHtml, 'text/html')
    const reader = new Readability(doc)
    const article = reader.parse()

    expect(article).toBeTruthy()

    // Use article.content (HTML) - the correct approach
    const htmlContent = article!.content
    const { segments: htmlSegments } = segmentHtmlContent('article-test', htmlContent)
    const htmlCombined = normalize(htmlSegments.map((s) => s.text).join(' '))

    // Verify all main content is preserved
    expect(htmlCombined.toLowerCase()).toContain('future of technology')
    expect(htmlCombined).toContain('unprecedented pace')
    expect(htmlCombined).toContain('artificial intelligence')
    expect(htmlCombined).toContain('quantum computing')
    expect(htmlCombined).toContain('Machine learning algorithms')
    expect(htmlCombined).toContain('quantum mechanics')
    expect(htmlCombined).toContain('cryptography')
    expect(htmlCombined).toContain('convergence of these technologies')
    expect(htmlCombined).toContain('ethical implications')
    expect(htmlCombined).toContain('common good')

    // Verify we have proper segmentation (multiple segments)
    expect(htmlSegments.length).toBeGreaterThan(5)

    // Use article.textContent (plain text) - the WRONG approach (what we're fixing)
    const plainText = article!.textContent
    const { segments: textSegments } = segmentHtmlContent('article-test-2', plainText)
    const textCombined = normalize(textSegments.map((s) => s.text).join(' '))

    // Content is still present with plain text
    expect(textCombined.toLowerCase()).toContain('future of technology')
    expect(textCombined).toContain('unprecedented pace')

    // But segmentation is worse - fewer segments because structure is lost
    // With plain text, all content runs together without clear boundaries
    // With HTML, paragraph and heading boundaries help create better segments
    expect(htmlSegments.length).toBeGreaterThanOrEqual(textSegments.length)

    // Verify HTML version has better structure preservation
    // Each paragraph should be a separate segment (or close to it)
    const htmlFirstSegment = htmlSegments[0]?.text || ''
    const textFirstSegment = textSegments[0]?.text || ''

    // HTML version should have cleaner, more focused segments
    // The plain text version might combine everything into one or few large chunks
    expect(htmlFirstSegment.length).toBeLessThan(textFirstSegment.length * 2)
  })

  it('handles articles without headings correctly', () => {
    const simpleArticleHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <article>
            <p>This is a simple article without any headings.</p>
            <p>It has multiple paragraphs of content.</p>
            <p>Each paragraph should be properly segmented.</p>
          </article>
        </body>
      </html>
    `

    const parser = new DOMParser()
    const doc = parser.parseFromString(simpleArticleHtml, 'text/html')
    const reader = new Readability(doc)
    const article = reader.parse()

    expect(article).toBeTruthy()

    const { segments } = segmentHtmlContent('simple-article', article!.content)
    const combined = normalize(segments.map((s) => s.text).join(' '))

    expect(combined).toContain('simple article without any headings')
    expect(combined).toContain('multiple paragraphs of content')
    expect(combined).toContain('properly segmented')
    expect(segments.length).toBeGreaterThan(0)
  })

  it('removes noise content (ads, sidebars, etc.) via Readability', () => {
    const noisyArticleHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <nav>Navigation content that should be removed</nav>
          <article>
            <h1>Main Article Title</h1>
            <p>This is the actual article content that we want to preserve.</p>
          </article>
          <aside>Sidebar content that should be removed</aside>
          <div class="advertisement">Ad content</div>
        </body>
      </html>
    `

    const parser = new DOMParser()
    const doc = parser.parseFromString(noisyArticleHtml, 'text/html')
    const reader = new Readability(doc)
    const article = reader.parse()

    expect(article).toBeTruthy()

    const { segments } = segmentHtmlContent('clean-article', article!.content)
    const combined = normalize(segments.map((s) => s.text).join(' '))

    // Main content should be present
    expect(combined).toContain('actual article content')

    // Noise should be removed by Readability
    expect(combined).not.toContain('Navigation content')
    expect(combined).not.toContain('Sidebar content')
    expect(combined).not.toContain('Ad content')
  })
})
