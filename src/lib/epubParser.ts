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
  // Strict HTML sanitization to prevent XSS attacks from malicious EPUB content.
  // This removes all executable JavaScript including event handlers and javascript: URLs.

  // First, parse it to DOM to process safely
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Remove dangerous elements that can execute scripts or load external content
  const toRemove = doc.querySelectorAll(
    'script, style, link, meta, title, head, iframe, object, embed, form, button, input, textarea, select, svg, base, applet'
  )
  toRemove.forEach((el) => el.remove())

  // Sanitize all elements in the entire document (not just body)
  const allElements = doc.querySelectorAll('*')
  allElements.forEach((el) => {
    // Remove all event handler attributes dynamically (any attribute starting with 'on')
    // This is more future-proof than maintaining a hardcoded list
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name)
      }
    })

    // Remove style attribute to prevent CSS-based attacks
    el.removeAttribute('style')

    // Remove class attribute to use our own styling
    el.removeAttribute('class')

    // Only keep id attributes that match the segment pattern (seg-*)
    if (el.hasAttribute('id')) {
      const id = el.getAttribute('id') || ''
      if (!/^seg-\w+/.test(id)) {
        el.removeAttribute('id')
      }
    }

    // Sanitize href attributes to prevent dangerous URL schemes
    if (el.hasAttribute('href')) {
      const href = el.getAttribute('href') || ''
      if (!isSafeUrl(href)) {
        el.removeAttribute('href')
      }
    }

    // Sanitize src attributes to prevent dangerous URL schemes
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src') || ''
      if (!isSafeUrl(src)) {
        el.removeAttribute('src')
      }
    }

    // Remove other potentially dangerous attributes
    el.removeAttribute('action')
    el.removeAttribute('formaction')
    el.removeAttribute('poster')
    el.removeAttribute('background')
    el.removeAttribute('srcdoc')
    el.removeAttribute('codebase')
  })

  return doc.body.innerHTML
}

/**
 * Check if a URL is safe to use in href or src attributes.
 * This function handles URL encoding to prevent bypass attacks.
 * @param url - The URL to check
 * @returns true if the URL is safe, false otherwise
 */
function isSafeUrl(url: string): boolean {
  if (!url) return true // Empty URLs are safe (will be removed by browser anyway)

  const trimmedUrl = url.trim()
  if (!trimmedUrl) return true

  // Decode URL to catch encoded attacks like %6A%61%76%61%73%63%72%69%70%74:
  let decodedUrl: string
  // Decode multiple times (up to a small limit) to catch nested encoding,
  // but stop if decoding fails or no further changes occur.
  const maxDecodes = 3
  for (let i = 0; i < maxDecodes; i++) {
    try {
      const onceDecoded = decodeURIComponent(decodedUrl)
      if (onceDecoded === decodedUrl) {
        break
      }
      decodedUrl = onceDecoded
    } catch {
      // If decoding fails at this level, stop decoding but keep the last
      // successfully decoded value for safety checks.
      break
    }
  }

  const lowerUrl = decodedUrl.toLowerCase().replace(/\s/g, '')

  // Block dangerous protocols
  const dangerousProtocols = [
    'javascript:',
    'data:',
    'vbscript:',
    'file:',
    'about:',
    'javascript&colon;',
    'vbscript&colon;',
  ]

  for (const protocol of dangerousProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      return false
    }
  }

  // Additional check: try parsing as URL if it looks like an absolute URL
  if (lowerUrl.includes(':')) {
    try {
      const urlObj = new URL(decodedUrl)
      const protocol = urlObj.protocol.toLowerCase()
      // Only allow http, https, and relative URLs
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== '') {
        return false
      }
    } catch {
      // If URL parsing fails but it contains ':', it might be malformed - be safe and reject
      if (lowerUrl.indexOf(':') < 20) {
        // Protocol should be within first 20 chars
        return false
      }
    }
  }

  return true
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
