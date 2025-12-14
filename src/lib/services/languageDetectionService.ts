import { detectChapterLanguage } from '../utils/languageDetector'
import { updateChapterDetectedLanguage } from '../libraryDB'
import type { Book } from '../types/book'
import logger from '../utils/logger'

/**
 * Detect language for all chapters in a book
 * This runs detection for each chapter and updates the book object in-place
 *
 * @param book The book with chapters to analyze
 * @returns The book with detected languages populated
 */
export async function detectLanguagesForBook(book: Book): Promise<Book> {
  const updatedChapters = await Promise.all(
    book.chapters.map(async (chapter) => {
      try {
        const result = detectChapterLanguage(chapter.content)
        return {
          ...chapter,
          detectedLanguage: result.languageCode,
          languageConfidence: result.confidence,
        }
      } catch (error) {
        logger.warn(`Failed to detect language for chapter ${chapter.id}:`, error)
        return chapter // Return unchanged if detection fails
      }
    })
  )

  return {
    ...book,
    chapters: updatedChapters,
  }
}

/**
 * Detect and persist language for all chapters in a library book
 * This runs detection and saves results to the database
 *
 * @param bookId The database ID of the book
 * @param book The book with chapters to analyze
 */
export async function detectAndPersistLanguagesForBook(bookId: number, book: Book): Promise<void> {
  const promises = book.chapters.map(async (chapter) => {
    try {
      const result = detectChapterLanguage(chapter.content)

      // Only persist if we got a meaningful result
      if (result.languageCode !== 'und' && result.confidence > 0) {
        await updateChapterDetectedLanguage(
          bookId,
          chapter.id,
          result.languageCode,
          result.confidence
        )
      }
    } catch (error) {
      logger.warn(
        `Failed to detect/persist language for chapter ${chapter.id} in book ${bookId}:`,
        error
      )
      // Continue with other chapters even if one fails
    }
  })

  await Promise.all(promises)
  logger.info(`Language detection completed for book ${bookId}`)
}

/**
 * Detect language for a single chapter and persist to database
 *
 * @param bookId The database ID of the book
 * @param chapterId The chapter ID
 * @param content The chapter content
 */
export async function detectAndPersistChapterLanguage(
  bookId: number,
  chapterId: string,
  content: string
): Promise<void> {
  try {
    const result = detectChapterLanguage(content)

    // Only persist if we got a meaningful result
    if (result.languageCode !== 'und' && result.confidence > 0) {
      await updateChapterDetectedLanguage(bookId, chapterId, result.languageCode, result.confidence)
    }
  } catch (error) {
    logger.warn(
      `Failed to detect/persist language for chapter ${chapterId} in book ${bookId}:`,
      error
    )
    throw error
  }
}
