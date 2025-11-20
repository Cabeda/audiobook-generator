export type EbookFormat = 'epub' | 'pdf' | 'txt' | 'html' | 'mobi' | 'azw3' | 'docx' | 'unknown'

/**
 * Detect ebook format from file
 * Uses multiple strategies: extension, MIME type, magic bytes
 */
export async function detectFormat(file: File): Promise<EbookFormat> {
  // 1. Check file extension
  const ext = getExtension(file.name)

  // 2. Check MIME type
  if (file.type) {
    const format = formatFromMime(file.type)
    if (format !== 'unknown') return format
  }

  // 3. Check magic bytes (file signature)
  const format = await detectFromMagicBytes(file)
  if (format !== 'unknown') return format

  // 4. Fallback to extension
  return formatFromExtension(ext)
}

/**
 * Get file extension from filename
 */
function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * Detect format from MIME type
 */
function formatFromMime(mimeType: string): EbookFormat {
  const mime = mimeType.toLowerCase()

  if (mime === 'application/epub+zip') return 'epub'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/plain') return 'txt'
  if (mime === 'text/html') return 'html'
  if (mime === 'application/x-mobipocket-ebook') return 'mobi'
  if (mime === 'application/vnd.amazon.ebook' || mime === 'application/vnd.amazon.mobi8-ebook') {
    return 'azw3'
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx'
  }

  return 'unknown'
}

/**
 * Detect format from file extension
 */
function formatFromExtension(ext: string): EbookFormat {
  switch (ext) {
    case 'epub':
      return 'epub'
    case 'pdf':
      return 'pdf'
    case 'txt':
      return 'txt'
    case 'html':
    case 'htm':
      return 'html'
    case 'mobi':
      return 'mobi'
    case 'azw3':
    case 'azw':
      return 'azw3'
    case 'docx':
      return 'docx'
    default:
      return 'unknown'
  }
}

/**
 * Check magic bytes (first few bytes of file) to identify format
 */
async function detectFromMagicBytes(file: File): Promise<EbookFormat> {
  try {
    // Read more bytes upfront for more reliable detection
    const header = await file.slice(0, 200).arrayBuffer()
    const bytes = new Uint8Array(header)

    // PDF: %PDF signature
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'pdf'
    }

    // EPUB/DOCX: PK signature (ZIP file)
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      // Check if it contains mimetype file for EPUB or [Content_Types].xml for DOCX
      const content = String.fromCharCode(...bytes.slice(0, 200))
      if (content.includes('epub')) return 'epub'
      if (content.includes('[Content_Types].xml')) return 'docx'
    }

    // MOBI: BOOKMOBI signature at offset 60
    if (file.size > 68) {
      const mobi = String.fromCharCode(...bytes.slice(60, 68))
      if (mobi === 'BOOKMOBI') return 'mobi'
    }

    return 'unknown'
  } catch (e) {
    console.warn('Failed to detect format from magic bytes:', e)
    return 'unknown'
  }
}
