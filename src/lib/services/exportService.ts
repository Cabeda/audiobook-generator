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
import { concatenateAudioChapters, downloadAudioFile, type AudioChapter } from '../audioConcat'
import type { EpubMetadata } from '../epub/epubGenerator'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { generatedAudio, book } from '../../stores/bookStore'
import { parseWavDuration } from './wavParser'
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
function getBookId(): number {
  const currentBook = get(book)
  if (hasBookId(currentBook)) {
    return currentBook.id
  }
  return 0
}

export async function exportAudio(
  chapters: Chapter[],
  format: 'mp3' | 'm4b' | 'wav' = 'mp3',
  bitrate = 192,
  bookInfo: { title: string; author: string }
) {
  // Ensure audio is loaded for all chapters (lazy load from DB if needed)
  const { ensureChaptersAudio } = await import('../../stores/bookStore')
  await ensureChaptersAudio(chapters.map((ch) => ch.id))

  const generated = get(generatedAudio)

  const audioChapters: AudioChapter[] = []
  for (const ch of chapters) {
    if (generated.has(ch.id)) {
      audioChapters.push({
        id: ch.id,
        title: ch.title,
        blob: generated.get(ch.id)!.blob,
      })
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
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${ch.title}</title></head>
<body><h1>${ch.title}</h1>${ch.content.replace(/&nbsp;/g, '&#160;')}</body></html>`,
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

        smilPars.push({
          textSrc: `../${ch.id}.xhtml#${s.id}`,
          audioSrc: `../audio/${ch.id}.mp3`,
          clipBegin,
          clipEnd,
        })

        cumulativeTime += duration
      }

      const totalDuration = cumulativeTime

      // Generate XHTML with matching IDs
      const sanitizedContent = ch.content.replace(/&nbsp;/g, '&#160;')
      const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${ch.title}</title></head>
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
