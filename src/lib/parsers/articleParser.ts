import { Readability } from '@mozilla/readability'
import type { Book, Chapter } from '../types/book'
import { dropHeadingMatching, htmlToText, sanitizeChapterHtml } from '../html/chapterHtml'

/**
 * Article import.
 *
 * A web page is mostly not the article: navigation, cookie banners, "related"
 * lists. Readeck extracts articles with go-readability, a port of Mozilla
 * Readability; this uses the same algorithm directly, so an imported page
 * becomes the one thing it is about — a single Chapter.
 */
export function parseArticle(html: string, url: string): Book | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Relative images have to be resolved against the page they came from.
  const base = doc.createElement('base')
  base.setAttribute('href', url)
  doc.head?.prepend(base)

  const article = new Readability(doc).parse()
  if (!article?.content) return null

  const holder = doc.createElement('div')
  holder.innerHTML = article.content

  // Readability prefers the page's <title>, which usually carries the site name
  // and not what the article is called. It also demotes the article's heading to
  // an h2, so the first heading of its output is the better name.
  const ownHeading = holder.querySelector('h1, h2, h3')
  const headingText = ownHeading?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const title =
    (headingText.length > 0 && headingText.length <= 120 ? headingText : '') ||
    article.title?.replace(/\s+/g, ' ').trim() ||
    hostOf(url)
  dropHeadingMatching(holder, title)

  const content = sanitizeChapterHtml(holder.innerHTML)
  const text = htmlToText(content)
  // Too short to be an article: navigation and banners are not something to
  // listen to, and the caller has a whole-page parser as a fallback.
  if (text.length < 120) return null

  const chapter: Chapter = { id: 'article', title, content }

  return {
    title,
    author: article.byline?.trim() || article.siteName?.trim() || hostOf(url),
    chapters: [chapter],
    format: 'article',
    language: article.lang ?? undefined,
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Article'
  }
}
