import JSZip from 'jszip'
import { generateSmil, type SmilData } from './smilGenerator'

export interface EpubChapter {
  id: string
  title: string
  content: string // XHTML content
  audioBlob?: Blob
  smilData?: SmilData
}

export interface EpubMetadata {
  title: string
  author: string
  language: string
  identifier: string
  cover?: Blob
}

export class EpubGenerator {
  private zip: JSZip
  private metadata: EpubMetadata
  private chapters: EpubChapter[] = []

  constructor(metadata: EpubMetadata) {
    this.zip = new JSZip()
    this.metadata = metadata
  }

  addChapter(chapter: EpubChapter) {
    this.chapters.push(chapter)
  }

  async generate(): Promise<Blob> {
    // 1. Mimetype (must be first, uncompressed)
    this.zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

    // 2. Container.xml
    this.zip.folder('META-INF')?.file(
      'container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    )

    const oebps = this.zip.folder('OEBPS')
    if (!oebps) throw new Error('Failed to create OEBPS folder')

    // 3. Add Content (XHTML, Audio, SMIL)
    for (const chapter of this.chapters) {
      // XHTML
      oebps.file(`${chapter.id}.xhtml`, chapter.content)

      // Audio & SMIL (if present)
      if (chapter.audioBlob && chapter.smilData) {
        oebps.file(`audio/${chapter.id}.mp3`, chapter.audioBlob)
        oebps.file(`smil/${chapter.id}.smil`, generateSmil(chapter.smilData))
      }
    }

    // 4. Add Cover (if present)
    if (this.metadata.cover) {
      oebps.file('cover.jpg', this.metadata.cover)
    }

    // 5. Generate content.opf
    oebps.file('content.opf', this.generateOpf())

    // 6. Generate toc.ncx (for backward compatibility)
    oebps.file('toc.ncx', this.generateNcx())

    // 7. Generate nav.xhtml (EPUB3 Navigation Document)
    oebps.file('nav.xhtml', this.generateNav())

    return await this.zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
  }

  private generateOpf(): string {
    const { title, author, language, identifier } = this.metadata
    const hasCover = !!this.metadata.cover

    let manifestItems = ''
    let spineItems = ''
    let durationMeta = ''

    // Nav
    manifestItems += `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n`
    // NCX
    manifestItems += `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n`
    // Cover
    if (hasCover) {
      manifestItems += `<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>\n`
    }

    // Calculate total duration for all media overlays
    let totalDuration = 0

    // Chapters
    this.chapters.forEach((chapter) => {
      const hasOverlay = !!chapter.smilData
      const overlayAttr = hasOverlay ? `media-overlay="${chapter.id}-smil"` : ''

      // XHTML
      manifestItems += `<item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml" ${overlayAttr}/>\n`

      // Audio & SMIL
      if (hasOverlay) {
        manifestItems += `<item id="${chapter.id}-audio" href="audio/${chapter.id}.mp3" media-type="audio/mpeg"/>\n`
        manifestItems += `<item id="${chapter.id}-smil" href="smil/${chapter.id}.smil" media-type="application/smil+xml"/>\n`

        // Add per-item duration meta
        const duration = chapter.smilData!.duration
        totalDuration += duration
        durationMeta += `    <meta property="media:duration" refines="#${chapter.id}-smil">${this.formatDuration(duration)}</meta>\n`
      }

      // Spine
      spineItems += `<itemref idref="${chapter.id}"/>\n`
    })

    // Add global duration meta (required by EPUB spec when media overlays are present)
    let globalDurationMeta = ''
    if (totalDuration > 0) {
      globalDurationMeta = `    <meta property="media:duration">${this.formatDuration(totalDuration)}</meta>\n`
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${this.escapeXml(title)}</dc:title>
    <dc:creator>${this.escapeXml(author)}</dc:creator>
    <dc:language>${language}</dc:language>
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
${globalDurationMeta}${durationMeta}  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`
  }

  /**
   * Format duration in seconds to SMIL clock value (HH:MM:SS.mmm)
   */
  private formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  }

  /**
   * Escape XML special characters in metadata values
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private generateNcx(): string {
    const { title, identifier } = this.metadata
    const navPoints = this.chapters
      .map(
        (c, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${this.escapeXml(c.title)}</text></navLabel>
      <content src="${c.id}.xhtml"/>
    </navPoint>`
      )
      .join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${identifier}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${this.escapeXml(title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`
  }

  private generateNav(): string {
    const { title } = this.metadata
    const lis = this.chapters
      .map((c) => `<li><a href="${c.id}.xhtml">${this.escapeXml(c.title)}</a></li>`)
      .join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${this.escapeXml(title)}</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
        ${lis}
      </ol>
    </nav>
  </body>
</html>`
  }
}
