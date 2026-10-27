import JSZip from 'jszip'
import type { Book, BookParser, Chapter, OnParseProgress } from './types/book'
import { dropHeadingMatching, sanitizeChapterBody } from './html/chapterHtml'
import { createZipReader, inlineChapterImages } from './epub/epubAssets'

// This file runs in the browser and depends on lib.dom being available.
// If your TypeScript environment complains, enable the 'dom' lib or
// provide a `global.d.ts` (see `src/global.d.ts`).

// Export types for backward compatibility
export type { Chapter }
export type EPubBook = Book

/**
 * EPUB parser implementing the BookParser interface
 */
export class EpubParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.epub') || file.type === 'application/epub+zip'
  }

  getFormatName(): string {
    return 'EPUB'
  }

  async parse(file: File, onProgress?: OnParseProgress): Promise<Book> {
    try {
      return await parseEpubFile(file, onProgress)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Detect specific failure patterns
      if (msg.includes('encrypted') || msg.includes('DRM')) {
        const { ParseError } = await import('./errors')
        throw new ParseError(msg, 'EPUB', 'encrypted', err instanceof Error ? err : undefined)
      }
      if (msg.includes('container.xml not found') || msg.includes('not a valid zip')) {
        const { ParseError } = await import('./errors')
        throw new ParseError(msg, 'EPUB', 'corrupt', err instanceof Error ? err : undefined)
      }
      throw err
    }
  }
}

function extractChapterTitle(
  chapterDoc: Document | null,
  guideTitle: string | undefined,
  _chapterContent: string,
  index: number
): string {
  const fallbackTitle = chapterDoc?.querySelector('head')?.querySelector('title')?.textContent
  const body = chapterDoc?.querySelector('body')
  const chapterTitleElement = body?.querySelector('h1.chapter-title')
  const chapterNameSpan = chapterTitleElement?.querySelector('span.chapter-name')
  const chapterTitleFromStructure = chapterNameSpan?.textContent || chapterTitleElement?.textContent
  const headings = [
    body?.querySelector('h1')?.textContent,
    body?.querySelector('h2')?.textContent,
    body?.querySelector('h3')?.textContent,
    body?.querySelector('section h1')?.textContent,
    body?.querySelector('section h2')?.textContent,
    body?.querySelector('section h3')?.textContent,
    chapterDoc?.querySelector('h1')?.textContent,
    chapterDoc?.querySelector('h2')?.textContent,
    chapterDoc?.querySelector('h3')?.textContent,
  ].filter((v): v is string => !!v)

  const headingTitle = headings.length > 0 ? headings[0] : null
  const title = (
    guideTitle ||
    chapterTitleFromStructure ||
    headingTitle ||
    chapterDoc?.querySelector('title')?.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
  return title || fallbackTitle || `Chapter ${index + 1}`
}

export async function parseEpubFile(file: File, onProgress?: OnParseProgress): Promise<EPubBook> {
  onProgress?.({ percent: 0, step: 'Reading eBook archive...' })
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()

  onProgress?.({ percent: 0.1, step: 'Reading metadata...' })
  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  if (!containerXml) throw new Error('container.xml not found in EPUB')
  const containerDoc = parser.parseFromString(containerXml, 'application/xml')
  const contentPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path') || ''
  const contentOpf = await zip.file(contentPath)?.async('text')
  if (!contentOpf) throw new Error('content.opf not found in EPUB')
  const contentDoc = parser.parseFromString(contentOpf, 'application/xml')

  // Query for title - try both non-namespaced and dc: namespaced versions
  const title =
    contentDoc.querySelector('title')?.textContent ||
    contentDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]
      ?.textContent ||
    'Unknown'

  const author =
    contentDoc.querySelector('creator')?.textContent ||
    contentDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]
      ?.textContent ||
    'Unknown'

  // Extract language (ISO 639-1 code like 'en', 'es', etc.)
  const language =
    contentDoc.querySelector('language')?.textContent ||
    contentDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'language')[0]
      ?.textContent ||
    undefined

  const coverImageId =
    contentDoc.querySelector("meta[name='cover']")?.getAttribute('content') || 'cover-image'
  const items = Array.from(contentDoc.querySelectorAll('item') || []) as Element[]
  const coverItem = items.find((i) => i.getAttribute('id') === coverImageId)
  const coverHref = coverItem?.getAttribute('href') || ''

  const spine = Array.from(contentDoc.querySelectorAll('itemref') || []) as Element[]
  const manifest = new Map(
    items.map((item) => [item.getAttribute('id') || '', item.getAttribute('href') || ''])
  )

  const baseDir = contentPath.split('/').slice(0, -1).join('/')

  const guideRefs = Array.from(contentDoc.querySelectorAll('guide reference') || []) as Element[]
  const chapterTitles = new Map(
    guideRefs.map((ref) => [
      ref.getAttribute('href')?.split('.')[0] || '',
      ref.getAttribute('title') || '',
    ])
  )

  onProgress?.({ percent: 0.2, step: 'Extracting chapters...' })
  const chapters: Chapter[] = []
  const assets = createZipReader(zip)
  const totalSpineItems = spine.length
  for (const [index, item] of spine.entries()) {
    const id = item.getAttribute('idref') || ''
    const href = manifest.get(id)
    if (href) {
      const fullPath = baseDir ? `${baseDir}/${href}` : href
      const fileObj = zip.file(fullPath)
      if (!fileObj) continue
      const chapterContent = await fileObj.async('text')
      const chapterDoc = parser.parseFromString(chapterContent, 'text/html')
      const body = chapterDoc.body
      if (!body) continue

      // Read the title before sanitizing: it looks at the source's own classes.
      const guideTitle = chapterTitles.get(id)
      const title = extractChapterTitle(chapterDoc, guideTitle, '', index)

      // The archive does not survive the import: inline its pictures first.
      await inlineChapterImages(body, assets, fullPath)
      sanitizeChapterBody(body)

      // The reader prints the title above the chapter; a heading that repeats it
      // would be shown and spoken twice.
      dropHeadingMatching(body, title)
      const content = body.innerHTML
      if (content) {
        chapters.push({ id: `chapter-${index + 1}`, title, content })
      }
    }
    // Report per-chapter progress (0.2 to 0.9 range)
    const chapterProgress = 0.2 + ((index + 1) / totalSpineItems) * 0.7
    onProgress?.({
      percent: chapterProgress,
      step: `Extracting chapter ${index + 1} of ${totalSpineItems}...`,
    })
  }

  onProgress?.({ percent: 0.9, step: 'Loading cover image...' })

  // Prepare cover as object URL if present
  let coverUrl: string | undefined = undefined
  if (coverHref) {
    const coverPath = baseDir ? `${baseDir}/${coverHref}` : coverHref
    const coverFile = zip.file(coverPath)
    if (coverFile) {
      const uint8 = await coverFile.async('uint8array')
      // Use the underlying ArrayBuffer to satisfy TypeScript BlobPart typing
      const blob = new Blob([uint8.buffer as ArrayBuffer], { type: 'image/jpeg' })
      coverUrl = URL.createObjectURL(blob)
    }
  }

  return {
    title,
    author,
    cover: coverUrl,
    chapters,
    format: 'epub',
    language,
  }
}

// Export singleton instance
export const epubParser = new EpubParser()
