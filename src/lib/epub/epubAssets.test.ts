import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { createZipReader, inlineChapterImages, resolveZipPath } from './epubAssets'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

async function zipWith(files: Record<string, Uint8Array | string>): Promise<JSZip> {
  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content)
  return zip
}

function bodyOf(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, 'text/html').body
}

describe('resolveZipPath', () => {
  it('resolves an href against the chapter directory', () => {
    expect(resolveZipPath('OEBPS/text', '../images/pic.png')).toBe('OEBPS/images/pic.png')
    expect(resolveZipPath('OEBPS/text', './pic.png')).toBe('OEBPS/text/pic.png')
    expect(resolveZipPath('', 'pic.png')).toBe('pic.png')
  })

  it('drops fragments and queries', () => {
    expect(resolveZipPath('OEBPS', 'images/a.jpg#frag')).toBe('OEBPS/images/a.jpg')
    expect(resolveZipPath('OEBPS', 'images/a.jpg?v=2')).toBe('OEBPS/images/a.jpg')
  })
})

describe('createZipReader', () => {
  it('reads an entry regardless of case or encoding', async () => {
    const zip = await zipWith({ 'OEBPS/Images/Pic.PNG': PNG_BYTES })
    const reader = createZipReader(zip)

    expect(await reader.read('OEBPS/images/pic.png')).not.toBeNull()
    expect(await reader.read('OEBPS/images/my%20pic.png')).toBeNull()
    expect(await reader.read('OEBPS/images/missing.png')).toBeNull()
  })
})

describe('inlineChapterImages', () => {
  it('inlines a relative image as a data URL', async () => {
    const zip = await zipWith({ 'OEBPS/images/pic.png': PNG_BYTES })
    const body = bodyOf('<p><img src="../images/pic.png" alt="A chart"></p>')

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/text/ch1.xhtml')

    const img = body.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(img?.getAttribute('alt')).toBe('A chart')
  })

  it('keeps the alt text when the picture cannot be shown', async () => {
    const zip = await zipWith({})
    const body = bodyOf('<p><img src="missing.png" alt="Missing picture"></p>')

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/ch1.xhtml')

    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent?.trim()).toBe('Missing picture')
  })

  it('drops a missing image that has no words to keep', async () => {
    const zip = await zipWith({})
    const body = bodyOf('<p>before<img src="missing.png">after</p>')

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/ch1.xhtml')

    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent?.trim()).toBe('beforeafter')
  })

  it('leaves remote images alone', async () => {
    const zip = await zipWith({})
    const body = bodyOf('<p><img src="https://example.com/a.png" alt="Remote"></p>')

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/ch1.xhtml')

    expect(body.querySelector('img')?.getAttribute('src')).toBe('https://example.com/a.png')
  })

  it('does not inline an image above the size limit', async () => {
    const big = new Uint8Array(64)
    const zip = await zipWith({ 'OEBPS/big.png': big })
    const body = bodyOf('<p><img src="big.png" alt="Huge"></p>')

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/ch1.xhtml', 32)

    expect(body.querySelector('img')).toBeNull()
    expect(body.textContent?.trim()).toBe('Huge')
  })

  it('turns an svg-wrapped image into a plain image', async () => {
    const zip = await zipWith({ 'OEBPS/pic.png': PNG_BYTES })
    const body = bodyOf(
      '<div><svg viewBox="0 0 10 10"><image xlink:href="pic.png" aria-label="Diagram"></image></svg></div>'
    )

    await inlineChapterImages(body, createZipReader(zip), 'OEBPS/ch1.xhtml')

    expect(body.querySelector('svg')).toBeNull()
    expect(body.querySelector('img')?.getAttribute('alt')).toBe('Diagram')
    expect(body.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  })
})
