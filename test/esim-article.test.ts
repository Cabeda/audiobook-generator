import { describe, it, expect, beforeAll } from 'vitest'
import { parseEpubFile } from '../src/lib/epubParser'
import { segmentHtmlContent } from '../src/lib/services/generationService'
import { resolve } from 'path'

describe('eSIM Article EPUB', () => {
  let esimFile: File

  beforeAll(async () => {
    // Load the eSIM article EPUB
    const epubPath = resolve(__dirname, '../example/esim_article.epub')
    const fs = await import('fs')
    const buffer = fs.readFileSync(epubPath)
    const blob = new Blob([buffer], { type: 'application/epub+zip' })
    esimFile = new File([blob], 'esim_article.epub', {
      type: 'application/epub+zip',
    })

    // Polyfill arrayBuffer method for File in test environment
    if (!esimFile.arrayBuffer) {
      Object.defineProperty(esimFile, 'arrayBuffer', {
        value: () => {
          const ab = new ArrayBuffer(buffer.length)
          const view = new Uint8Array(ab)
          for (let i = 0; i < buffer.length; i++) {
            view[i] = buffer[i]
          }
          return Promise.resolve(ab)
        },
      })
    }

    // Polyfill URL.createObjectURL for test environment
    if (!URL.createObjectURL) {
      URL.createObjectURL = () => 'blob:mock-url'
    }
  })

  it('should segment the eSIM article correctly with full paragraph highlighting', async () => {
    // Parse the EPUB
    const book = await parseEpubFile(esimFile)
    expect(book.chapters.length).toBeGreaterThan(0)

    const chapter = book.chapters[0]
    console.log('\nFirst chapter:', chapter.title)
    console.log('Content length:', chapter.content.length)
    console.log('First 500 chars:', chapter.content.substring(0, 500))

    // Segment the content
    const { segments } = segmentHtmlContent(chapter.id, chapter.content)

    console.log('\nTotal segments:', segments.length)
    console.log('First 15 segments:')
    segments.slice(0, 15).forEach((seg, idx) => {
      console.log(`  [${idx}] ${seg.text}`)
    })

    // Combine all segment texts
    const allSegmentText = segments.map((s) => s.text).join(' ')

    // Check if key phrases are in the segments
    expect(allSegmentText).toContain('SIM cards')
    expect(allSegmentText).toContain('mobile subscriber information')
    expect(allSegmentText).toContain('since time immemorial')
    expect(allSegmentText).toContain('on the verge of extinction')
    expect(allSegmentText).toContain('In an effort to save space')
    expect(allSegmentText).toContain('dropping the SIM slot')
    expect(allSegmentText).toContain('Google is the latest')
    expect(allSegmentText).toContain('Pixel 10 series')
    expect(allSegmentText).toContain('After long avoiding eSIM')
    expect(allSegmentText).toContain('And boy, do I regret it')

    // HTML should NOT contain wrapped segments (wrapping happens in TextReader component)
    // The segmentation just creates the segment list
    expect(segments.length).toBe(65)

    console.log('\nSegmentation complete - wrapping will happen in TextReader component')
  })
})
