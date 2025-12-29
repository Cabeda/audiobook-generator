import { describe, it, expect, beforeAll } from 'vitest'
import { segmentHtmlContent } from '../src/lib/services/generationService'
import { readFileSync } from 'fs'
import { join } from 'path'
import JSZip from 'jszip'

/**
 * Test to verify that segmentation is consistent across different code paths
 * This ensures highlighting doesn't change between page load and reload
 */
describe('Segmentation Consistency', () => {
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

  it('should produce identical segments from generationService.segmentHtmlContent()', () => {
    // Run segmentation via generationService
    const { segments: genServiceSegments } = segmentHtmlContent('test-chapter', esimHtml)

    // Verify we got segments
    expect(genServiceSegments.length).toBeGreaterThan(0)
    // eSIM article has 68 segments after fixing container element handling
    // to ensure headings and paragraphs are always separate segments
    expect(genServiceSegments.length).toBe(68)

    // Verify key segments are present and correct
    const segmentTexts = genServiceSegments.map((s) => s.text)
    const fullText = segmentTexts.join(' ')

    expect(fullText).toContain('SIM cards')
    expect(fullText).toContain('mobile subscriber information')
    expect(fullText).toContain('since time immemorial')
    expect(fullText).toContain('on the verge of extinction')
  })

  it('should maintain consistent segment boundaries across multiple segmentations', () => {
    // Run segmentation multiple times to ensure deterministic behavior
    const segmentations = Array.from({ length: 5 }, () =>
      segmentHtmlContent('test-chapter', esimHtml)
    )

    // All segmentations should produce the same number of segments
    const segmentCounts = segmentations.map((s) => s.segments.length)
    expect(new Set(segmentCounts).size).toBe(1) // All counts should be identical

    // All segmentations should produce identical text
    const segmentTexts = segmentations.map((s) => s.segments.map((seg) => seg.text).join('|||'))
    expect(new Set(segmentTexts).size).toBe(1) // All text sequences should be identical
  })

  it('should contain the full paragraph about SIM cards correctly segmented', () => {
    const { segments } = segmentHtmlContent('test-chapter', esimHtml)

    // Find segments 7-9 which contain the full paragraph
    const paragraph7 = segments[7]?.text ?? ''
    const paragraph8 = segments[8]?.text ?? ''
    const paragraph9 = segments[9]?.text ?? ''

    // These segments should contain the specific phrases from the paragraph
    expect(paragraph7).toContain('SIM cards')
    expect(paragraph7).toContain('small slips of plastic')
    expect(paragraph7).toContain('mobile subscriber information')
    expect(paragraph7).toContain('since time immemorial')
    expect(paragraph7).toContain('on the verge of extinction')

    expect(paragraph8).toContain('In an effort to save space')
    expect(paragraph8).toContain('Pixel 10 series')

    expect(paragraph9).toContain('After long avoiding eSIM')
    expect(paragraph9).toContain('no choice but to take the plunge')

    // "regret it" should appear somewhere in the segments
    const fullSegmentText = segments
      .slice(7, 15)
      .map((s) => s.text)
      .join(' ')
    expect(fullSegmentText).toContain('regret it')
  })
})
