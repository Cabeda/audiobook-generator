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

  // List of all known event handler attributes that could execute JavaScript
  const eventHandlers = [
    'onabort',
    'onafterprint',
    'onanimationcancel',
    'onanimationend',
    'onanimationiteration',
    'onanimationstart',
    'onauxclick',
    'onbeforecopy',
    'onbeforecut',
    'onbeforeinput',
    'onbeforepaste',
    'onbeforeprint',
    'onbeforeunload',
    'onblur',
    'oncancel',
    'oncanplay',
    'oncanplaythrough',
    'onchange',
    'onclick',
    'onclose',
    'oncontextmenu',
    'oncopy',
    'oncuechange',
    'oncut',
    'ondblclick',
    'ondrag',
    'ondragend',
    'ondragenter',
    'ondragleave',
    'ondragover',
    'ondragstart',
    'ondrop',
    'ondurationchange',
    'onemptied',
    'onended',
    'onerror',
    'onfocus',
    'onfocusin',
    'onfocusout',
    'onformdata',
    'ongotpointercapture',
    'onhashchange',
    'oninput',
    'oninvalid',
    'onkeydown',
    'onkeypress',
    'onkeyup',
    'onlanguagechange',
    'onload',
    'onloadeddata',
    'onloadedmetadata',
    'onloadstart',
    'onlostpointercapture',
    'onmessage',
    'onmessageerror',
    'onmousedown',
    'onmouseenter',
    'onmouseleave',
    'onmousemove',
    'onmouseout',
    'onmouseover',
    'onmouseup',
    'onmousewheel',
    'onoffline',
    'ononline',
    'onpagehide',
    'onpageshow',
    'onpaste',
    'onpause',
    'onplay',
    'onplaying',
    'onpointercancel',
    'onpointerdown',
    'onpointerenter',
    'onpointerleave',
    'onpointermove',
    'onpointerout',
    'onpointerover',
    'onpointerup',
    'onpopstate',
    'onprogress',
    'onratechange',
    'onrejectionhandled',
    'onreset',
    'onresize',
    'onscroll',
    'onsearch',
    'onsecuritypolicyviolation',
    'onseeked',
    'onseeking',
    'onselect',
    'onselectionchange',
    'onselectstart',
    'onshow',
    'onstalled',
    'onstorage',
    'onsubmit',
    'onsuspend',
    'ontimeupdate',
    'ontoggle',
    'ontouchcancel',
    'ontouchend',
    'ontouchmove',
    'ontouchstart',
    'ontransitioncancel',
    'ontransitionend',
    'ontransitionrun',
    'ontransitionstart',
    'onunhandledrejection',
    'onunload',
    'onvolumechange',
    'onwaiting',
    'onwebkitanimationend',
    'onwebkitanimationiteration',
    'onwebkitanimationstart',
    'onwebkittransitionend',
    'onwheel',
  ]

  // Sanitize all elements
  const allElements = doc.body.querySelectorAll('*')
  allElements.forEach((el) => {
    // Remove all event handler attributes
    eventHandlers.forEach((handler) => {
      el.removeAttribute(handler)
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

    // Sanitize href attributes to prevent javascript: URLs
    if (el.hasAttribute('href')) {
      const href = el.getAttribute('href') || ''
      const trimmedHref = href.trim().toLowerCase()
      // Remove javascript:, data:, vbscript:, and other dangerous protocols
      if (
        trimmedHref.startsWith('javascript:') ||
        trimmedHref.startsWith('data:') ||
        trimmedHref.startsWith('vbscript:') ||
        trimmedHref.startsWith('file:') ||
        trimmedHref.startsWith('about:')
      ) {
        el.removeAttribute('href')
      }
    }

    // Sanitize src attributes for images to prevent javascript: URLs and data: URLs
    // Note: data: URLs are blocked for consistency with href handling, even though
    // they're generally safe for images, they could be used for social engineering
    if (el.hasAttribute('src')) {
      const src = el.getAttribute('src') || ''
      const trimmedSrc = src.trim().toLowerCase()
      if (
        trimmedSrc.startsWith('javascript:') ||
        trimmedSrc.startsWith('data:') ||
        trimmedSrc.startsWith('vbscript:') ||
        trimmedSrc.startsWith('file:') ||
        trimmedSrc.startsWith('about:')
      ) {
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
    el.removeAttribute('data')
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
