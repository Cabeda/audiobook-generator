import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { parseEpubFile } from './epubParser'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

async function epubWith(chapterHtml: string): Promise<File> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container><rootfiles>
      <rootfile full-path="OEBPS/content.opf"/>
    </rootfiles></container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>A Book</dc:title><dc:creator>A. Writer</dc:creator></metadata>
      <manifest>
        <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="pic" href="images/pic.png" media-type="image/png"/>
      </manifest>
      <spine><itemref idref="ch1"/></spine>
    </package>`
  )
  zip.file('OEBPS/ch1.xhtml', chapterHtml)
  zip.file('OEBPS/images/pic.png', PNG_BYTES)

  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'book.epub', { type: 'application/epub+zip' })
}

describe('epubParser chapter content', () => {
  it('keeps the structure and inlines the images', async () => {
    const book = await parseEpubFile(
      await epubWith(`<html><head><title>One</title></head><body>
        <h1>Chapter One</h1>
        <p>A picture: <img src="images/pic.png" alt="A chart"></p>
        <ul><li>First point</li></ul>
      </body></html>`)
    )
    const chapter = book.chapters[0]

    expect(chapter.title).toBe('Chapter One')
    expect(chapter.content).not.toContain('<h1>')
    expect(chapter.content).toContain('<ul><li>First point</li></ul>')
    expect(chapter.content).toContain('src="data:image/png;base64,')
  })
})
