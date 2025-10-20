import JSZip from 'jszip'

// This file runs in the browser and depends on lib.dom being available.
// If your TypeScript environment complains, enable the 'dom' lib or
// provide a `global.d.ts` (see `src/global.d.ts`).

export interface Chapter {
  id: string
  title: string
  content: string
}

export interface EPubBook {
  title: string
  author: string
  cover?: string // object URL (blob:...)
  chapters: Chapter[]
}

function cleanHtml(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return text.replace(/\s+/g, ' ').trim()
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
  const title = guideTitle || cleanHtml(chapterTitleFromStructure || headingTitle || chapterDoc?.querySelector('title')?.textContent || '')
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
  const title = contentDoc.querySelector('title')?.textContent || 
                contentDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]?.textContent ||
                'Unknown'
  
  const author = contentDoc.querySelector('creator')?.textContent || 
                 contentDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]?.textContent ||
                 'Unknown'

  const coverImageId = contentDoc.querySelector("meta[name='cover']")?.getAttribute('content') || 'cover-image'
  const items = Array.from(contentDoc.querySelectorAll('item') || []) as Element[]
  const coverItem = items.find(i => i.getAttribute('id') === coverImageId)
  const coverHref = coverItem?.getAttribute('href') || ''

  const spine = Array.from(contentDoc.querySelectorAll('itemref') || []) as Element[]
  const manifest = new Map(
    items.map((item) => [item.getAttribute('id') || '', item.getAttribute('href') || ''])
  )

  const baseDir = contentPath.split('/').slice(0, -1).join('/')

  const guideRefs = Array.from(contentDoc.querySelectorAll('guide reference') || []) as Element[]
  const chapterTitles = new Map(
    guideRefs.map(ref => [ref.getAttribute('href')?.split('.')[0] || '', ref.getAttribute('title') || ''])
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
        chapters.push({ id: `chapter-${index+1}`, title, content })
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
  }
}
