/**
 * Audiobook service.
 *
 * The generation and export actions the revamp UI drives: generate what is
 * missing, retry what failed (clearing its error first), and export the book —
 * audio in the chosen format, or the book itself as EPUB.
 */

import { get } from 'svelte/store'
import type { Book } from '../types/book'
import { isAudioExportFormat, type ExportFormat } from '../exportFormats'
import { chapterErrors, chapterStatus } from '../../stores/bookStore'
import { generationService } from './generationService'
import { exportAudio, exportEpub } from './exportService'

export interface BookExportOptions {
  format: ExportFormat
  /** Audio formats: encoding bitrate in kbps. */
  bitrate?: number
  /** EPUB: cover art to embed. */
  cover?: Blob
}

/** Generate audio for the chapters that do not have any yet. */
export async function generateMissing(book: Book, bookId?: number): Promise<void> {
  const status = get(chapterStatus)
  const missing = book.chapters.filter((chapter) => status.get(chapter.id) !== 'done')
  if (missing.length === 0) return
  await generationService.generateChapters(missing, bookId)
}

/** Retry failed chapters: clear their errors, then generate them again. */
export async function retryChapters(
  book: Book,
  chapterIds: string[],
  bookId?: number
): Promise<void> {
  chapterErrors.update((map) => {
    const next = new Map(map)
    for (const id of chapterIds) next.delete(id)
    return next
  })
  const retry = book.chapters.filter((chapter) => chapterIds.includes(chapter.id))
  if (retry.length > 0) await generationService.generateChapters(retry, bookId)
}

/**
 * Make a chapter again with the plan in force now, starting at the sentence
 * being heard. Used when the voice or engine changes mid-listen: the audio
 * ahead of the listener was made by the old narrator.
 */
export async function reprocessChapter(
  book: Book,
  chapterId: string,
  bookId?: number,
  fromSegment = 0
): Promise<void> {
  const chapter = book.chapters.find((c) => c.id === chapterId)
  if (!chapter) return
  generationService.setReaderPosition(chapterId, Math.max(0, fromSegment))
  await generationService.generateChapters([chapter], bookId)
}

/** Export the book: audio in the chosen format, or the book itself as EPUB. */
export async function exportBook(book: Book, options: BookExportOptions): Promise<void> {
  const bookInfo = { title: book.title, author: book.author, cover: options.cover }
  if (!isAudioExportFormat(options.format)) {
    await exportEpub(book.chapters, bookInfo)
    return
  }
  await exportAudio(book.chapters, options.format, options.bitrate ?? 192, bookInfo)
}
