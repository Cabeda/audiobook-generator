/**
 * EPUB images.
 *
 * A spine item's `<img src="images/x.jpg">` points inside the archive. The
 * archive is gone once the book is stored, so each image is inlined as a
 * `data:` URL before the chapter is saved — otherwise the picture is there
 * until the tab closes. Images too big to inline keep their alt text instead,
 * because the words still mean something to a listener.
 */

import type JSZip from 'jszip'
import logger from '../utils/logger'

/** Above this, an image costs more than the words that describe it. */
const MAX_INLINE_BYTES = 2 * 1024 * 1024

// No SVG: `data:image/svg+xml` can carry script, which is exactly what the
// chapter sanitizer exists to keep out.
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

export interface ZipAssetReader {
  /** Bytes of an archive entry, or null when the archive does not have it. */
  read(path: string): Promise<Uint8Array | null>
}

/** Join an href with the directory it is relative to, resolving `..` and `.`. */
export function resolveZipPath(baseDir: string, href: string): string {
  const withoutQuery = href.split('#')[0].split('?')[0]
  const parts: string[] = []
  for (const part of `${baseDir}/${withoutQuery}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/**
 * A reader over the archive's entries.
 *
 * EPUB producers disagree about case and percent-encoding, so lookups are
 * forgiving: exact, then decoded, then case-insensitive.
 */
export function createZipReader(zip: JSZip): ZipAssetReader {
  const byLowerPath = new Map<string, string>()
  for (const path of Object.keys(zip.files)) byLowerPath.set(path.toLowerCase(), path)

  async function entryAt(path: string) {
    const direct = zip.file(path)
    if (direct) return direct
    const decoded = safeDecode(path)
    const decodedEntry = decoded === path ? null : zip.file(decoded)
    if (decodedEntry) return decodedEntry
    const actual = byLowerPath.get(path.toLowerCase()) ?? byLowerPath.get(decoded.toLowerCase())
    return actual ? zip.file(actual) : null
  }

  return {
    async read(path: string) {
      const entry = await entryAt(path)
      if (!entry) return null
      return entry.async('uint8array')
    },
  }
}

/** Inline the images a chapter references, in place. */
export async function inlineChapterImages(
  body: HTMLElement,
  assets: ZipAssetReader,
  chapterPath: string,
  maxBytes = MAX_INLINE_BYTES
): Promise<void> {
  const doc = body.ownerDocument
  const baseDir = chapterPath.split('/').slice(0, -1).join('/')

  unwrapSvgImages(body)

  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    const alt = (img.getAttribute('alt') ?? '').trim()
    // Already self-contained or served from the web: nothing to inline.
    if (!src || /^(?:https?|data):/i.test(src)) continue

    const bytes = await readImage(assets, baseDir, src)

    if (!bytes) {
      // Nothing to show: keep the words, drop the broken picture.
      replaceImage(img, alt ? doc.createElement('p') : null, alt)
      continue
    }

    const mime = MIME_BY_EXTENSION[extensionOf(src)]
    if (!mime || bytes.length > maxBytes) {
      logger.info(`[EPUB] Not inlining image ${src} (${bytes.length} bytes)`)
      replaceImage(img, alt ? doc.createElement('p') : null, alt)
      continue
    }

    img.setAttribute('src', toDataUrl(bytes, mime))
  }
}

/**
 * Turn `<svg><image href="x.jpg"></svg>` into a plain `<img>`.
 *
 * The sanitizer removes `svg` (it can carry script), so an image wrapped in one
 * has to become an `img` first or the picture disappears with the wrapper.
 */
function unwrapSvgImages(body: HTMLElement): void {
  for (const svg of Array.from(body.querySelectorAll('svg'))) {
    const image = svg.querySelector('image')
    const href =
      image?.getAttribute('href') ??
      image?.getAttribute('xlink:href') ??
      image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (!image || !href) continue

    const img = body.ownerDocument.createElement('img')
    img.setAttribute('src', href)
    const alt = image.getAttribute('aria-label') ?? ''
    if (alt) img.setAttribute('alt', alt)
    svg.replaceWith(img)
  }
}

async function readImage(
  assets: ZipAssetReader,
  baseDir: string,
  src: string
): Promise<Uint8Array | null> {
  return assets.read(resolveZipPath(baseDir, src))
}

function replaceImage(img: Element, replacement: Element | null, alt: string): void {
  if (replacement) {
    replacement.textContent = alt
    img.replaceWith(replacement)
  } else {
    img.remove()
  }
}

function extensionOf(path: string): string {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)
  return match ? match[1].toLowerCase() : ''
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}
