/**
 * Chapter wrapping.
 *
 * Segmentation (sentence spans for highlighting) is per chapter, and a large
 * book must not pay for all of it at once: wrap a chapter when it is first
 * shown, and keep the result. The cache is the whole point — re-wrapping on
 * every render is what made large books stall on phones.
 */

import { segmentHtmlContent } from '../services/segmentationService'

export interface WrappedChapter {
  html: string
  segments: { index: number; text: string; id: string }[]
}

export function createChapterWrapper(): (chapterId: string, content: string) => WrappedChapter {
  const cache = new Map<string, WrappedChapter>()
  return (chapterId, content) => {
    const cached = cache.get(chapterId)
    if (cached) return cached
    const wrapped = segmentHtmlContent(chapterId, content)
    cache.set(chapterId, wrapped)
    return wrapped
  }
}
