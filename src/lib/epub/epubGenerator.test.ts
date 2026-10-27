import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { EpubGenerator } from './epubGenerator'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

function generatorWith(content: string): EpubGenerator {
  const epub = new EpubGenerator({
    title: 'A Book',
    author: 'A. Writer',
    language: 'en',
    identifier: 'urn:uuid:test',
  })
  epub.addChapter({ id: 'chapter-1', title: 'One', content })
  return epub
}

async function filesOf(epub: EpubGenerator): Promise<JSZip> {
  return JSZip.loadAsync(await (await epub.generate()).arrayBuffer())
}

describe('EpubGenerator', () => {
  it('writes an inlined image as a file and points the chapter at it', async () => {
    const zip = await filesOf(
      generatorWith(`<html><body><p><img src="${PNG}" alt="A chart"/></p></body></html>`)
    )

    const chapter = await zip.file('OEBPS/chapter-1.xhtml')?.async('text')
    expect(chapter).toContain('src="images/image-1.png"')
    expect(chapter).not.toContain('data:image')

    expect(zip.file('OEBPS/images/image-1.png')).not.toBeNull()

    const opf = await zip.file('OEBPS/content.opf')?.async('text')
    expect(opf).toContain('href="images/image-1.png" media-type="image/png"')
  })

  it('writes the same picture once when two chapters use it', async () => {
    const epub = generatorWith(`<html><body><img src="${PNG}"/></body></html>`)
    epub.addChapter({
      id: 'chapter-2',
      title: 'Two',
      content: `<html><body><img src="${PNG}"/></body></html>`,
    })

    const zip = await filesOf(epub)
    const images = Object.keys(zip.files).filter((path) => path.endsWith('.png'))

    expect(images).toEqual(['OEBPS/images/image-1.png'])
    expect(await zip.file('OEBPS/chapter-2.xhtml')?.async('text')).toContain('images/image-1.png')
  })
})
