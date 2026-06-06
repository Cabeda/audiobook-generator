/**
 * Audio and EPUB export service.
 *
 * Handles exporting generated audiobook audio to various formats (MP3, M4B, WAV)
 * and exporting EPUB files with embedded audio and SMIL synchronization.
 *
 * Extracted from generationService to isolate export concerns from generation logic.
 */

import { get } from 'svelte/store'
import type { Chapter } from '../types/book'
import type { AudioSegment } from '../types/audio'
import { concatenateAudioChapters, type AudioChapter } from '../audioConcat'
import { downloadAudioFile } from '../wavUtils'
import type { EpubMetadata } from '../epub/epubGenerator'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { generatedAudio, book } from '../../stores/bookStore'
import { parseWavDuration } from './wavParser'
import { parseMp3Duration } from './mp3DurationParser'
import type { LibraryBook } from '../libraryDB'

/**
 * Type representing a LibraryBook with a guaranteed ID property
 */
type LibraryBookWithId = LibraryBook & { id: number }

/**
 * Type guard to check if a book has an ID property (i.e., is a LibraryBook with ID)
 */
function hasBookId(book: unknown): book is LibraryBookWithId {
  return (
    book !== null &&
    book !== undefined &&
    typeof book === 'object' &&
    'id' in book &&
    typeof (book as LibraryBookWithId).id === 'number'
  )
}

/**
 * Helper function to safely extract the book ID from the book store.
 */
export function getBookId(): number {
  const currentBook = get(book)
  if (hasBookId(currentBook)) {
    return currentBook.id
  }
  return 0
}

/**
 * Escape special XML characters in text content
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Sanitize HTML content to produce valid XHTML for EPUB.
 *
 * Handles common issues from various EPUB sources (Standard Ebooks,
 * Project Gutenberg, Readeck, etc.):
 * - Self-closing void elements (<br>, <img>, <hr>, <input>, <meta>, <link>)
 * - &nbsp; → &#160;
 * - Removes <img> tags referencing missing local resources (../images/*)
 * - Rewrites internal links to non-bundled XHTML files as plain text
 * - Strips XML processing instructions that may be embedded in content
 * - Removes stray CDATA sections
 * - Normalizes common HTML entities to their numeric equivalents
 * - Removes empty anchor tags (<a id="..."></a> → <span id="..."></span>)
 */
function sanitizeXhtml(html: string): string {
  let result = html

  // Replace common named entities with numeric equivalents (valid in XHTML)
  result = result.replace(/&nbsp;/g, '&#160;')
  result = result.replace(/&mdash;/g, '&#8212;')
  result = result.replace(/&ndash;/g, '&#8211;')
  result = result.replace(/&lsquo;/g, '&#8216;')
  result = result.replace(/&rsquo;/g, '&#8217;')
  result = result.replace(/&ldquo;/g, '&#8220;')
  result = result.replace(/&rdquo;/g, '&#8221;')
  result = result.replace(/&hellip;/g, '&#8230;')
  result = result.replace(/&trade;/g, '&#8482;')
  result = result.replace(/&copy;/g, '&#169;')
  result = result.replace(/&reg;/g, '&#174;')

  // Remove <img> tags that reference local images we don't bundle
  // (e.g., ../images/titlepage.svg, ../images/logo.svg, images/cover.jpg)
  result = result.replace(/<img[^>]*src=["'][^"']*images\/[^"']*["'][^>]*\/?>/gi, '')

  // Rewrite internal links to non-bundled .xhtml/.html files as plain text
  // e.g., <a href="uncopyright.xhtml">text</a> → text
  // Keep external links (http/https) and fragment links (#) intact
  result = result.replace(
    /<a\s+[^>]*href=["'](?!https?:\/\/)(?!#)([^"']*\.(?:xhtml|html)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    '$2'
  )

  // Strip XML processing instructions embedded in content (<?xml ...?>)
  result = result.replace(/<\?xml[^?]*\?>/gi, '')

  // Remove CDATA sections (sometimes left over from source EPUBs)
  result = result.replace(/<!\[CDATA\[/g, '')
  result = result.replace(/\]\]>/g, '')

  // Fix self-closing void elements: <br>, <hr>, <img>, <input>, <meta>, <link>, <col>, <area>, <base>
  // Convert <br> to <br/>, <img ...> to <img .../>, etc.
  const voidElements = ['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base']
  for (const tag of voidElements) {
    // Match tags that are NOT already self-closed (don't end with />)
    // Pattern: <tag ... > (without closing slash)
    const openTagRegex = new RegExp(`<(${tag})(\\s[^>]*)?>(?!</${tag}>)`, 'gi')
    result = result.replace(openTagRegex, (match) => {
      // If already self-closed, leave it
      if (match.endsWith('/>')) return match
      // Otherwise, make it self-closing
      return match.slice(0, -1) + '/>'
    })
  }

  return result
}

export async function exportAudio(
  chapters: Chapter[],
  format: 'mp3' | 'm4b' | 'wav' = 'mp3',
  bitrate = 192,
  bookInfo: { title: string; author: string }
) {
  const { getChapterSegments } = await import('../libraryDB')
  const { incrementalConcatWav } = await import('../wavUtils')

  // Try to load merged audio from the store first
  const { ensureChaptersAudio } = await import('../../stores/bookStore')
  await ensureChaptersAudio(chapters.map((ch) => ch.id))

  const generated = get(generatedAudio)
  const bookId = getBookId()

  const audioChapters: AudioChapter[] = []
  for (const ch of chapters) {
    if (generated.has(ch.id)) {
      // Merged audio already available (legacy path or previously concatenated)
      audioChapters.push({
        id: ch.id,
        title: ch.title,
        blob: generated.get(ch.id)!.blob,
      })
    } else if (bookId) {
      // No merged audio — concatenate from segments in IndexedDB on-demand
      // This is the normal path since we now defer concatenation to export time
      try {
        const segments = await getChapterSegments(bookId, ch.id)
        if (segments.length > 0) {
          logger.info(
            `[Export] Concatenating ${segments.length} segments for chapter "${ch.title}" on-demand`
          )
          // Collect all segment blobs (by index order)
          const sortedSegments = [...segments].sort((a, b) => a.index - b.index)
          const chapterBlob = await incrementalConcatWav(sortedSegments.length, async (index) => {
            return sortedSegments[index]?.audioBlob ?? null
          })
          const chapterDuration = sortedSegments.reduce((sum, s) => sum + (s.duration || 0), 0)
          audioChapters.push({
            id: ch.id,
            title: ch.title,
            blob: chapterBlob,
            duration: chapterDuration,
          })
        }
      } catch (e) {
        // If incrementalConcatWav fails (e.g., format mismatch between segments),
        // fall back to concatenating raw segment blobs and let Mediabunny handle resampling
        logger.warn(
          `[Export] incrementalConcatWav failed for chapter ${ch.id}, trying raw blob fallback:`,
          e instanceof Error ? e.message : e
        )
        try {
          const segments = await getChapterSegments(bookId, ch.id)
          const sortedSegments = [...segments].sort((a, b) => a.index - b.index)
          const validBlobs = sortedSegments
            .map((s) => s.audioBlob)
            .filter((b): b is Blob => b != null && b.size > 0)
          if (validBlobs.length > 0) {
            // Just concatenate the raw bytes — Mediabunny's Conversion API will handle
            // resampling when encoding to MP3/M4B
            const combined = new Blob(validBlobs, { type: 'audio/wav' })
            audioChapters.push({
              id: ch.id,
              title: ch.title,
              blob: combined,
            })
          }
        } catch (fallbackErr) {
          logger.error(`[Export] Fallback also failed for chapter ${ch.id}:`, fallbackErr)
        }
      }
    }
  }

  if (audioChapters.length === 0) {
    toastStore.warning('No generated audio found for selected chapters')
    return
  }

  try {
    const combined = await concatenateAudioChapters(
      audioChapters,
      {
        format,
        bitrate,
        bookTitle: bookInfo.title,
        bookAuthor: bookInfo.author,
      },
      (p) => console.log('Concatenating:', p.message)
    )

    const ext = format === 'wav' ? 'wav' : format === 'm4b' ? 'm4b' : 'mp3'
    const filename = `${bookInfo.title.replace(/[^a-z0-9]/gi, '_')}_audiobook.${ext}`
    downloadAudioFile(combined, filename)
  } catch (e) {
    logger.error('Export failed', e)
    toastStore.error('Export failed: ' + (e instanceof Error ? e.message : 'Unknown error'))
  }
}

export async function exportEpub(
  chapters: Chapter[],
  bookInfo: { title: string; author: string; cover?: Blob }
) {
  const { EpubGenerator } = await import('../epub/epubGenerator')
  const { getChapterSegments } = await import('../libraryDB')

  const metadata: EpubMetadata = {
    title: bookInfo.title,
    author: bookInfo.author,
    language: 'en',
    identifier: `urn:uuid:${crypto.randomUUID()}`,
    cover: bookInfo.cover,
  }

  const epub = new EpubGenerator(metadata)
  const totalChapters = chapters.length

  const bookId = getBookId()

  if (!bookId) {
    toastStore.error('Cannot export: Book ID not found')
    return
  }

  try {
    for (let i = 0; i < totalChapters; i++) {
      const ch = chapters[i]

      // Get segments
      let segments: AudioSegment[] = []
      try {
        segments = await getChapterSegments(bookId, ch.id)
      } catch (e) {
        logger.warn(`Could not load segments for chapter ${ch.id}`, e)
      }

      if (segments.length === 0) {
        epub.addChapter({
          id: ch.id,
          title: ch.title,
          content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" epub:prefix="z3998: http://www.daisy.org/z3986/2012/vocab/structure/ se: https://standardebooks.org/vocab/1.0">
<head><title>${escapeXml(ch.title)}</title></head>
<body><h1>${escapeXml(ch.title)}</h1>${sanitizeXhtml(ch.content)}</body></html>`,
        })
        continue
      }

      // Concatenate segment audio into a single MP3 per chapter
      const audioChaptersToConcat: AudioChapter[] = segments.map((s) => ({
        id: s.id,
        title: `Segment ${s.index}`,
        blob: s.audioBlob,
      }))

      const combinedBlob = await concatenateAudioChapters(audioChaptersToConcat, {
        format: 'mp3',
        bitrate: 128,
      })

      // Generate sanitized XHTML content (needed before SMIL to check fragment IDs)
      const sanitizedContent = sanitizeXhtml(ch.content)

      // Build SMIL timing data from segment durations
      let cumulativeTime = 0
      const smilPars = []

      for (let j = 0; j < segments.length; j++) {
        const s = segments[j]

        // Calculate duration from blob if stored duration is missing/invalid
        let duration = s.duration
        if (!duration || duration <= 0) {
          try {
            duration = await parseWavDuration(s.audioBlob)
          } catch {
            // Last resort: estimate assuming 24kHz 16-bit mono (48000 bytes/sec)
            duration = (s.audioBlob.size - 44) / (24000 * 2)
          }
          if (duration < 0) duration = 1 // Minimum fallback
        }

        const clipBegin = cumulativeTime
        const clipEnd = cumulativeTime + duration

        // Only include SMIL entry if the segment ID exists in the XHTML content.
        // Some segments may have been skipped during generation (empty text, etc.)
        // and their IDs won't be in the XHTML, causing epubcheck RSC-012 errors.
        if (sanitizedContent.includes(`id="${s.id}"`)) {
          smilPars.push({
            textSrc: `../${ch.id}.xhtml#${s.id}`,
            audioSrc: `../audio/${ch.id}.mp3`,
            clipBegin,
            clipEnd,
          })
        }

        cumulativeTime += duration
      }

      // Scale SMIL clip times to match actual MP3 duration.
      // WAV-based durations drift from the encoded MP3 due to frame padding.
      const wavTotalDuration = cumulativeTime
      const mp3Duration = await parseMp3Duration(combinedBlob)
      const scaleFactor =
        mp3Duration > 0 && wavTotalDuration > 0 ? mp3Duration / wavTotalDuration : 1

      if (scaleFactor !== 1) {
        for (const par of smilPars) {
          par.clipBegin *= scaleFactor
          par.clipEnd *= scaleFactor
        }
      }

      const totalDuration = mp3Duration > 0 ? mp3Duration : wavTotalDuration

      // Generate XHTML with matching IDs
      const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" epub:prefix="z3998: http://www.daisy.org/z3986/2012/vocab/structure/ se: https://standardebooks.org/vocab/1.0">
<head><title>${escapeXml(ch.title)}</title></head>
<body>
  ${sanitizedContent}
</body>
</html>`

      epub.addChapter({
        id: ch.id,
        title: ch.title,
        content: xhtmlContent,
        audioBlob: combinedBlob,
        smilData: {
          id: `${ch.id}-smil`,
          duration: totalDuration,
          pars: smilPars,
        },
      })
    }

    const epubBlob = await epub.generate()
    const filename = `${bookInfo.title.replace(/[^a-z0-9]/gi, '_')}.epub`
    downloadAudioFile(epubBlob, filename)
  } catch (err) {
    logger.error('EPUB Export failed', err)
    toastStore.error('EPUB Export failed')
  }
}
