import JSZip from 'jszip'
import type { Book, BookParser, Chapter } from './types/book'

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

  async parse(file: File): Promise<Book> {
    return parseEpubFile(file)
  }
}

function cleanHtml(html: string): string {
  // Remove potentially dangerous elements (scripts, styles, forms, etc.) and strip inline styles/classes to ensure clean rendering.
  // Simple sanitation: remove script, style, object, embed, iframe, form, input, button, etc.
  // This approach removes known dangerous tags and strips most attributes, but does not strictly whitelist only certain tags.

  // First, parse it to DOM to process safely
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Remove unwanted elements
  const toRemove = doc.querySelectorAll(
    'script, style, link, meta, title, head, iframe, object, embed, form, button, input, textarea, select, svg'
  )
  toRemove.forEach((el) => el.remove())

  // Unwrap unwanted containers but keep text? Or just remove?
  // Let's keep it simple: The body innerHTML is mostly what we want, but cleaned.

  // Remove attributes that might interfere (onclick, style usually not needed but maybe keep style?)
  // For safety and clean look: strip all attributes except maybe src for images?
  // Let's strip attributes for now to ensure clean styling via our CSS.
  // Exception: keep 'src', 'href' if we want links (links might navigate away, so maybe strip href too or target blank?)
  // For 'TextReader', simple structure is best.

  const allElements = doc.body.querySelectorAll('*')
  allElements.forEach((el) => {
    // Keep only specific attributes if needed
    // Remove inline styles to respect our theme
    el.removeAttribute('style')
    el.removeAttribute('class') // Strip classes to use our own or default
    el.removeAttribute('id') // We will generate our own IDs
    el.removeAttribute('onclick')
  })

  return doc.body.innerHTML
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
  const title =
    guideTitle ||
    cleanHtml(
      chapterTitleFromStructure ||
        headingTitle ||
        chapterDoc?.querySelector('title')?.textContent ||
        ''
    )
  return title || fallbackTitle || `Chapter ${index + 1}`
}

export async function parseEpubFile(file: File): Promise<EPubBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const parser = new DOMParser()

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

  const chapters: Chapter[] = []
  for (const [index, item] of spine.entries()) {
    const id = item.getAttribute('idref') || ''
    const href = manifest.get(id)
    if (href) {
      const fullPath = baseDir ? `${baseDir}/${href}` : href
      const fileObj = zip.file(fullPath)
      if (!fileObj) continue
      const chapterContent = await fileObj.async('text')
      const chapterDoc = parser.parseFromString(chapterContent, 'text/html')
      const content = cleanHtml(chapterDoc.querySelector('body')?.innerHTML || '')
      const guideTitle = chapterTitles.get(id)
      const title = extractChapterTitle(chapterDoc, guideTitle, content, index)
      if (content) {
        chapters.push({ id: `chapter-${index + 1}`, title, content })
      }
    }
  }

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
