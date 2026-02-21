import type { Book, BookParser, Chapter, OnParseProgress } from '../types/book'
import { readFileAsText } from '../fileUtils'

/**
 * Parser for plain text files (.txt)
 * Attempts to intelligently detect chapters and extract metadata
 */
export class TxtParser implements BookParser {
  async canParse(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase()
    return ext.endsWith('.txt') || file.type === 'text/plain'
  }

  getFormatName(): string {
    return 'TXT'
  }

  async parse(file: File, _onProgress?: OnParseProgress): Promise<Book> {
    const text = await readFileAsText(file)

    // Extract metadata from first lines
    const metadata = this.extractMetadata(text)

    // Detect and split chapters
    const chapters = this.detectChapters(text, metadata.contentStart)

    return {
      title: metadata.title,
      author: metadata.author,
      chapters,
      format: 'txt',
    }
  }

  /**
   * Extract title and author from common text file patterns
   */
  private extractMetadata(text: string): {
    title: string
    author: string
    contentStart: number
  } {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    let title = 'Untitled'
    let author = 'Unknown'
    let contentStart = 0

    // Common pattern: Title on first line, Author on second
    if (lines.length >= 2) {
      const firstLine = lines[0]
      const secondLine = lines[1]

      // Check if second line starts with "by" or "By"
      if (secondLine.toLowerCase().startsWith('by ')) {
        title = firstLine
        author = secondLine.replace(/^by\s+/i, '').trim()
        contentStart = 2
      }
      // Check for "Author:" prefix
      else if (secondLine.toLowerCase().startsWith('author:')) {
        title = firstLine
        author = secondLine.replace(/^author:\s*/i, '').trim()
        contentStart = 2
      }
      // Just use first line as title
      else {
        title = firstLine
        contentStart = 1
      }
    } else if (lines.length >= 1) {
      title = lines[0]
      contentStart = 1
    }

    // Fallback to filename if title is empty or very short
    if (!title || title.length < 3) {
      title = this.extractTitleFromFilename(text)
    }

    return { title, author, contentStart }
  }

  /**
   * Extract a reasonable title from the first line or filename
   */
  private extractTitleFromFilename(text: string): string {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    return lines[0] || 'Untitled Text File'
  }

  /**
   * Detect chapters using various heuristics
   */
  private detectChapters(text: string, contentStartLine: number): Chapter[] {
    const lines = text.split('\n')

    // Skip metadata lines
    const contentLines = lines.slice(this.findContentStartIndex(lines, contentStartLine))

    // Try different chapter detection strategies
    const chapters =
      this.detectByChapterHeadings(contentLines) ||
      this.detectByNumberedSections(contentLines) ||
      this.detectByBlankLineSeparators(contentLines)

    return chapters
  }

  /**
   * Find the actual start of content (skipping blank lines after metadata)
   */
  private findContentStartIndex(lines: string[], startLine: number): number {
    let index = startLine
    while (index < lines.length && lines[index].trim().length === 0) {
      index++
    }
    return index
  }

  /**
   * Detect chapters by looking for "Chapter" headings
   * Patterns: "Chapter 1", "CHAPTER I", "Chapter One", etc.
   */
  private detectByChapterHeadings(lines: string[]): Chapter[] | null {
    const chapterPattern =
      /^(chapter|ch\.?)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)/i

    const chapterIndices: { index: number; title: string }[] = []

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      if (chapterPattern.test(trimmed)) {
        chapterIndices.push({ index: idx, title: trimmed })
      }
    })

    // Need at least 2 chapters to consider this valid
    if (chapterIndices.length < 2) {
      return null
    }

    // Extract content between chapter headings
    const chapters: Chapter[] = []

    for (let i = 0; i < chapterIndices.length; i++) {
      const startIdx = chapterIndices[i].index
      const endIdx = i + 1 < chapterIndices.length ? chapterIndices[i + 1].index : lines.length

      const chapterLines = lines.slice(startIdx + 1, endIdx)
      const content = chapterLines.join('\n').trim()

      if (content.length > 0) {
        chapters.push({
          id: `chapter-${i + 1}`,
          title: chapterIndices[i].title,
          content,
        })
      }
    }

    return chapters.length > 0 ? chapters : null
  }

  /**
   * Detect chapters by numbered sections (1., 2., 3., etc.)
   */
  private detectByNumberedSections(lines: string[]): Chapter[] | null {
    const sectionPattern = /^(\d+)\.\s+(.+)$/

    const sectionIndices: { index: number; number: number; title: string }[] = []

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      const match = trimmed.match(sectionPattern)
      if (match) {
        sectionIndices.push({
          index: idx,
          number: parseInt(match[1]),
          title: match[2],
        })
      }
    })

    // Need at least 3 sequential numbered sections
    if (sectionIndices.length < 3) {
      return null
    }

    // Check if numbers are sequential (1, 2, 3, ...)
    const isSequential = sectionIndices.every((sec, idx) => {
      if (idx === 0) return sec.number === 1
      return sec.number === sectionIndices[idx - 1].number + 1
    })

    if (!isSequential) {
      return null
    }

    // Extract content
    const chapters: Chapter[] = []

    for (let i = 0; i < sectionIndices.length; i++) {
      const startIdx = sectionIndices[i].index
      const endIdx = i + 1 < sectionIndices.length ? sectionIndices[i + 1].index : lines.length

      const chapterLines = lines.slice(startIdx + 1, endIdx)
      const content = chapterLines.join('\n').trim()

      if (content.length > 0) {
        chapters.push({
          id: `section-${sectionIndices[i].number}`,
          title: sectionIndices[i].title,
          content,
        })
      }
    }

    return chapters.length > 0 ? chapters : null
  }

  /**
   * Fallback: Split by large blank line gaps (2+ consecutive blank lines)
   */
  private detectByBlankLineSeparators(lines: string[]): Chapter[] {
    const chapters: Chapter[] = []
    let currentChunk: string[] = []
    let blankLineCount = 0
    let chunkNumber = 1

    for (const line of lines) {
      if (line.trim().length === 0) {
        blankLineCount++
      } else {
        // If we had 2+ blank lines, start a new chapter
        if (blankLineCount >= 2 && currentChunk.length > 0) {
          const content = currentChunk.join('\n').trim()
          if (content.length > 100) {
            // Only create chapter if substantial content
            // Use first line as title (truncated if too long)
            const firstLine = content.split('\n')[0].substring(0, 80)
            chapters.push({
              id: `part-${chunkNumber}`,
              title: firstLine || `Part ${chunkNumber}`,
              content,
            })
            chunkNumber++
          }
          currentChunk = []
        }

        currentChunk.push(line)
        blankLineCount = 0
      }
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      const content = currentChunk.join('\n').trim()
      if (content.length > 100) {
        const firstLine = content.split('\n')[0].substring(0, 80)
        chapters.push({
          id: `part-${chunkNumber}`,
          title: firstLine || `Part ${chunkNumber}`,
          content,
        })
      }
    }

    // If we didn't find meaningful sections, create one big chapter
    if (chapters.length === 0) {
      const allContent = lines.join('\n').trim()
      if (allContent.length > 0) {
        chapters.push({
          id: 'full-text',
          title: 'Full Text',
          content: allContent,
        })
      }
    }

    return chapters
  }
}

// Export singleton instance
export const txtParser = new TxtParser()
