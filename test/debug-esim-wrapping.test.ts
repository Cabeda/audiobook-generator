import { describe, it, expect, beforeAll, vi } from 'vitest'

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
import { readFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'

describe('Debug eSIM Wrapping', () => {
  let esimHtml: string

  beforeAll(async () => {
    // Load the eSIM EPUB file
    const epubPath = join(process.cwd(), 'example/esim_article.epub')
    const epubBuffer = readFileSync(epubPath)
    const zip = new JSZip()
    await zip.loadAsync(epubBuffer)

    // Extract first chapter
    const packageDoc = await zip.file('OEBPS/content.opf')?.async('text')
    if (!packageDoc) throw new Error('Could not find OEBPS/content.opf')

    const packageParser = new DOMParser()
    const doc = packageParser.parseFromString(packageDoc, 'text/xml')
    const spineItems = doc.querySelectorAll('spine itemref')
    const firstItemId = spineItems[0]?.getAttribute('idref')
    const manifestItem = doc.querySelector(`manifest item[id="${firstItemId}"]`)
    const chapterHref = manifestItem?.getAttribute('href')

    if (!chapterHref) throw new Error('Could not determine chapter href')

    const chapterContent = await zip.file(`OEBPS/${chapterHref}`)?.async('text')
    if (!chapterContent) throw new Error(`Could not load chapter content from OEBPS/${chapterHref}`)

    esimHtml = chapterContent
  })

  it('should show the HTML structure around the problematic sentence', () => {
    // Find the paragraph containing "In an effort to save space"
    const searchTerm = 'In an effort to save space'
    const idx = esimHtml.indexOf(searchTerm)
    expect(idx).toBeGreaterThan(-1)

    // Show context around that paragraph
    const contextStart = Math.max(0, idx - 200)
    const contextEnd = Math.min(esimHtml.length, idx + 500)
    console.log('\n=== HTML CONTEXT AROUND PROBLEMATIC SENTENCE ===')
    console.log(esimHtml.slice(contextStart, contextEnd))
    console.log('\n=== END CONTEXT ===')

    // Now segment and check wrapping
    const { html: wrappedHtml, segments } = segmentHtmlContent('test-chapter', esimHtml)

    // Find the segment containing this sentence
    const targetSentence = 'In an effort to save space for other components'
    const matchingSegments = segments.filter((s) => s.text.includes(targetSentence))
    console.log('\n=== MATCHING SEGMENTS ===')
    matchingSegments.forEach((s) => {
      console.log(`Segment ${s.index}: ${s.text}`)
    })

    // Check if the wrapped HTML contains the span for this segment
    if (matchingSegments.length > 0) {
      const segId = matchingSegments[0].id
      const hasSpan = wrappedHtml.includes(`id="${segId}"`)
      console.log(`\nWrapped HTML contains span with id="${segId}": ${hasSpan}`)

      // Show the wrapped HTML around this area
      const wrappedIdx = wrappedHtml.indexOf(targetSentence)
      if (wrappedIdx > -1) {
        const wrappedContextStart = Math.max(0, wrappedIdx - 200)
        const wrappedContextEnd = Math.min(wrappedHtml.length, wrappedIdx + 600)
        console.log('\n=== WRAPPED HTML AROUND TARGET ===')
        console.log(wrappedHtml.slice(wrappedContextStart, wrappedContextEnd))
        console.log('\n=== END WRAPPED CONTEXT ===')
      } else {
        console.log('\nTarget sentence not found in wrapped HTML!')
        // Search for "Pixel 10" to see what happened
        const pixelIdx = wrappedHtml.indexOf('Pixel 10')
        if (pixelIdx > -1) {
          console.log('\n=== WRAPPED HTML AROUND "Pixel 10" ===')
          console.log(wrappedHtml.slice(Math.max(0, pixelIdx - 400), pixelIdx + 200))
          console.log('\n=== END ===')
        }
      }
    }

    // Show which segments did NOT get wrapped
    const unwrappedSegments = segments.filter((s) => !wrappedHtml.includes(`id="${s.id}"`))
    console.log('\n=== SEGMENTS NOT WRAPPED IN HTML ===')
    unwrappedSegments.forEach((s) => {
      console.log(`Segment ${s.index}: ${s.text.slice(0, 80)}...`)
    })

    expect(matchingSegments.length).toBeGreaterThan(0)
  })
})
