/**
 * Chapter HTML sanitization.
 *
 * A Chapter's content is HTML: headings, lists, tables and images are what the
 * reader shows and what the app speaks. Everything that enters a chapter — an
 * EPUB spine item, an uploaded page, an article, a reconstructed PDF — comes
 * through here, so one allowlist governs what may run and what may load.
 *
 * Two gates, because chapter HTML is untrusted input rendered with `{@html}`:
 * elements that can execute or fetch are removed outright, and URLs are checked
 * by scheme. Inline images are stored as `data:` URLs so a book survives a
 * reload, which is the one place `data:` is allowed — in `src`, never `href`.
 */

const REMOVED_TAGS = [
  'script',
  'style',
  'link',
  'meta',
  'title',
  'head',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'textarea',
  'select',
  'svg',
  'base',
  'applet',
  'noscript',
].join(', ')

const DROPPED_ATTRIBUTES = ['action', 'formaction', 'poster', 'background', 'srcdoc', 'codebase']

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]*$/i

const DANGEROUS_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'about:',
  'javascript&colon;',
  'vbscript&colon;',
]

/**
 * Whether a URL in chapter content may be kept.
 *
 * Decodes first, because encoding is how `javascript:` gets past a naive
 * check. Relative URLs are always fine.
 */
export function isSafeChapterUrl(url: string, options: { allowDataImage?: boolean } = {}): boolean {
  const trimmed = url.trim()
  if (!trimmed) return true
  if (options.allowDataImage && DATA_IMAGE.test(trimmed)) return true

  let decoded = trimmed
  for (let i = 0; i < 3; i++) {
    try {
      const once = decodeURIComponent(decoded)
      if (once === decoded) break
      decoded = once
    } catch {
      break
    }
  }

  const lower = decoded.toLowerCase().replace(/\s/g, '')
  if (DANGEROUS_PROTOCOLS.some((protocol) => lower.startsWith(protocol))) return false

  if (lower.includes(':')) {
    try {
      const scheme = new URL(decoded).protocol.toLowerCase()
      if (scheme !== 'http:' && scheme !== 'https:') return false
    } catch {
      // Not a parseable absolute URL: only reject when it looks like a scheme.
      if (lower.indexOf(':') < 20) return false
    }
  }

  return true
}

/** Sanitize a chapter body in place. */
export function sanitizeChapterBody(body: HTMLElement): void {
  body.querySelectorAll(REMOVED_TAGS).forEach((el) => el.remove())

  for (const el of Array.from(body.querySelectorAll('*'))) {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase()

      if (name.startsWith('on')) {
        el.removeAttribute(attribute.name)
      } else if (name === 'style' || name === 'class') {
        // Chapter content is styled by the reader, not by the source document.
        el.removeAttribute(attribute.name)
      } else if (name === 'id') {
        // Only segment ids mean anything to the reader and the EPUB export.
        if (!/^seg-\w+/.test(attribute.value)) el.removeAttribute(attribute.name)
      } else if (name === 'href') {
        if (!isSafeChapterUrl(attribute.value)) el.removeAttribute(attribute.name)
      } else if (name === 'src') {
        if (!isSafeChapterUrl(attribute.value, { allowDataImage: true })) {
          el.removeAttribute(attribute.name)
        }
      }
    }

    for (const name of DROPPED_ATTRIBUTES) el.removeAttribute(name)
  }
}

/** Sanitize chapter HTML and give it back as the string a Chapter stores. */
export function sanitizeChapterHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  sanitizeChapterBody(doc.body)
  return doc.body.innerHTML
}

/**
 * Drop the heading that repeats a chapter's title.
 *
 * The reader prints the title above the chapter, so a document heading with the
 * same words would be shown and spoken twice.
 */
export function dropHeadingMatching(root: ParentNode, title: string): void {
  const normalize = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
  const heading = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
    (candidate) => normalize(candidate.textContent) === normalize(title)
  )
  heading?.remove()
}

/**
 * The words of a chapter, without the HTML.
 *
 * For the places that only care about text — word counts, reading time,
 * language detection — so they don't each hand-roll a tag stripper.
 */
export function htmlToText(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, head').forEach((el) => el.remove())

  // A block ends a word: without this, "</p><p>" would glue two words together.
  const blocks =
    'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, figcaption, td, th, dt, dd'
  doc.querySelectorAll(blocks).forEach((el) => el.after(doc.createTextNode(' ')))
  doc.querySelectorAll('br').forEach((el) => el.replaceWith(doc.createTextNode(' ')))

  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}
