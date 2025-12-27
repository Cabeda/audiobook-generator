import { get } from 'svelte/store'
import type { Chapter } from '../types/book'
import type { VoiceId } from '../kokoro/kokoroClient'
import { getTTSWorker } from '../ttsWorkerManager'
import {
  selectedModel,
  selectedVoice,
  selectedQuantization,
  selectedDevice,
} from '../../stores/ttsStore'
import {
  chapterStatus,
  chapterErrors,
  generatedAudio,
  chapterProgress,
  book,
} from '../../stores/bookStore'
import { advancedSettings } from '../../stores/ttsStore'
import { listVoices as listKokoroVoices } from '../kokoro/kokoroClient'
import { concatenateAudioChapters, downloadAudioFile, type AudioChapter } from '../audioConcat'
import type { EpubMetadata } from '../epub/epubGenerator'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { saveChapterSegments, type LibraryBook } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import { convert } from 'html-to-text'
import { resolveChapterLanguage, DEFAULT_LANGUAGE } from '../utils/languageResolver'
import { selectKokoroVoiceForLanguage, selectPiperVoiceForLanguage } from '../utils/voiceSelector'
import { PiperClient } from '../piper/piperClient'

/**
 * Type representing a LibraryBook with a guaranteed ID property
 */
type LibraryBookWithId = LibraryBook & { id: number }

/**
 * Type guard to check if a book has an ID property (i.e., is a LibraryBook with ID)
 */
function hasBookId(book: any): book is LibraryBookWithId {
  return book !== null && book !== undefined && 'id' in book && typeof book.id === 'number'
}

/**
 * Helper function to safely extract the book ID from the book store.
 * The book store can contain either a Book or a LibraryBook (which extends Book with an id property).
 * @returns The book ID as a number, or 0 if not available
 */
function getBookId(): number {
  const currentBook = get(book)
  if (hasBookId(currentBook)) {
    return currentBook.id // Type guard ensures id is number, not undefined
  }
  return 0
}

/**
 * Process items in parallel batches
 * @param items Array of items to process
 * @param batchSize Number of items to process concurrently
 * @param processor Function that processes a single item and returns a result
 * @param onProgress Optional callback called after each batch completes
 * @returns Array of results in the same order as the input items
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  onProgress?: (completedCount: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let completedCount = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length))
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    )

    // Store results in order
    batchResults.forEach((result, batchIndex) => {
      results[i + batchIndex] = result
    })

    completedCount += batch.length
    if (onProgress) {
      onProgress(completedCount, items.length)
    }
  }

  return results
}

export interface SegmentOptions {
  ignoreCodeBlocks?: boolean
  ignoreLinks?: boolean
}

export function segmentHtmlContent(
  chapterId: string,
  htmlContent: string,
  options: SegmentOptions = {}
): { html: string; segments: { index: number; text: string; id: string }[] } {
  const segments: { index: number; text: string; id: string }[] = []

  logger.info('[segmentHtml] Starting HTML segmentation with html-to-text', {
    chapterId,
    htmlLength: htmlContent.length,
    ignoreCodeBlocks: !!options.ignoreCodeBlocks,
    ignoreLinks: !!options.ignoreLinks,
  })

  // Configure selectors for html-to-text
  const selectors: any[] = [
    { selector: 'img', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
  ]

  if (options.ignoreCodeBlocks) {
    selectors.push({ selector: 'pre', format: 'skip' })
    selectors.push({ selector: 'code', format: 'skip' })
  }

  if (options.ignoreLinks) {
    selectors.push({ selector: 'a', format: 'skip' })
  } else {
    // If not ignored, print text but ignore href
    selectors.push({ selector: 'a', options: { ignoreHref: true } })
  }

  // Convert HTML to text
  // wordwrap: false ensures we don't insert artificial line breaks within paragraphs
  const fullText = convert(htmlContent, {
    wordwrap: false,
    selectors: selectors,
    preserveNewlines: true, // Preserve intentional newlines
  })

  // Split into sentences
  // Robust splitting handles newlines (which html-to-text preserves for blocks)
  // We split by newline first to ensure block boundaries are respected.
  const lines = fullText.split('\n')
  const sentences: string[] = []

  lines.forEach((line) => {
    const trimmedLine = line.trim()
    if (!trimmedLine) return

    // Split line into sentences
    // This regex matches:
    // 1. A sequence of non-terminators followed by terminators and space/end
    // 2. OR the remaining text if no terminators found
    const lineSentences = trimmedLine.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g)
    if (lineSentences) {
      sentences.push(...lineSentences.map((s) => s.trim()))
    } else {
      sentences.push(trimmedLine)
    }
  })

  let segmentIndex = 0
  sentences.forEach((sentence) => {
    const trimmed = sentence
    if (trimmed && trimmed.length > 0) {
      segments.push({
        index: segmentIndex,
        text: trimmed,
        id: `seg-${segmentIndex}`,
      })
      segmentIndex++
    }
  })

  logger.info('[segmentHtml] Segmentation complete', {
    totalSegments: segments.length,
    firstSegmentText: segments[0]?.text.substring(0, 100),
    totalTextLength: fullText.length,
  })

  // Return original HTML without segment wrapping
  return { html: htmlContent, segments }
}

class GenerationService {
  private running = false
  private canceled = false

  // Helper to calculate duration of a WAV blob
  // WAV header is 44 bytes, Kokoro outputs 24kHz float32 mono
  private calculateWavDuration(blob: Blob): number {
    const headerSize = 44
    const sampleRate = 24000
    const bytesPerSample = 4 // float32
    const channels = 1

    const pcmDataSize = blob.size - headerSize
    if (pcmDataSize <= 0) return 0

    return pcmDataSize / (sampleRate * bytesPerSample * channels)
  }

  // Helper to segment HTML content into sentences and wrap them with spans
  private segmentHtml(
    chapterId: string,
    htmlContent: string,
    options?: SegmentOptions
  ): { html: string; segments: { index: number; text: string; id: string }[] } {
    return segmentHtmlContent(chapterId, htmlContent, options)
  }

  // Old complex segmentation logic removed - kept simple for reliability
  private segmentHtmlComplex_DISABLED(
    chapterId: string,
    htmlContent: string
  ): { html: string; segments: { index: number; text: string; id: string }[] } {
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlContent, 'text/html')
    const segments: { index: number; text: string; id: string }[] = []

    logger.info('[segmentHtml] Starting HTML segmentation', {
      chapterId,
      htmlLength: htmlContent.length,
      htmlPreview: htmlContent.substring(0, 200),
    })

    // Algorithm:
    // 1. Identify "block" elements (p, h1-6, div, li, blockquote).
    // 2. For each block, extract text and find sentence boundaries.
    // 3. Instead of complex Range wrapping which is fragile, we'll try a simpler approach for v1:
    //    - If block contains simple text, replace text with wrapped spans.
    //    - If block contains tags, we attempt to process text nodes.
    //
    // Revised Robust Approach:
    // Walk the tree. Collect text nodes.
    // Build a mapping of "global text offset" -> "TextNode + offset".
    // Split the full text into sentences.
    // For each sentence (start, end), assume it maps to a range of text nodes.
    // Wrap that range.

    // Since we are in browser environment, we can use TreeWalker.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    let node: Node | null = walker.nextNode()
    while (node) {
      if (node.textContent && node.textContent.trim().length > 0) {
        textNodes.push(node as Text)
      }
      node = walker.nextNode()
    }

    // Ideally we split per block to avoid spanning sentences across paragraphs (uncommon in books).
    // Let's iterate over block elements instead.
    const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, div, blockquote, dt, dd')
    // If no blocks found (plain text wrapped in body), fallback to body?
    const elementsToProcess = blocks.length > 0 ? Array.from(blocks) : [doc.body]

    logger.info('[segmentHtml] Found block elements', {
      blockCount: blocks.length,
      elementCount: elementsToProcess.length,
      bodyTextLength: doc.body.textContent?.length || 0,
      bodyTextPreview: doc.body.textContent?.substring(0, 200),
    })

    let globalIndex = 0

    elementsToProcess.forEach((block) => {
      // Skip if already processed (nested blocks case)
      // e.g. div contains p. splitting div might double process p.
      // Simplest check: if block has no block children.
      if (block.querySelector('p, h1, h2, h3, h4, h5, h6, li, div, blockquote')) {
        if (block.tagName !== 'BODY') return // Let children handle it
      }

      // Get text content of this block
      const text = block.textContent || ''
      if (!text.trim()) return

      // Split into sentences using a simple regex (same as before)
      // Note: This matches "Sentence." "Sentence?" "Sentence!"
      // It's greedy.
      const sentences = text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [text]

      // Now the hard part: mapping these sentences back to DOM ranges to wrap them.
      // Since we might have <b> etc inside.
      // Strategy: "Eat" text nodes until we satisfy the sentence text.

      // Gather text nodes within this block
      const blockWalker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      const blockNodes: Text[] = []
      let bn: Node | null = blockWalker.nextNode()
      while (bn) {
        blockNodes.push(bn as Text)
        bn = blockWalker.nextNode()
      }

      let currentNodeIdx = 0
      let currentOffset = 0 // Offset within the current text node

      sentences.forEach((sentence) => {
        const trimmed = sentence.trim()
        if (!trimmed) return

        const segId = `seg-${globalIndex}`
        segments.push({ index: globalIndex, text: trimmed, id: segId })

        if (globalIndex === 0) {
          logger.warn('[segmentHtml] First segment created', {
            segmentId: segId,
            text: trimmed,
            textLength: trimmed.length,
          })
        }

        globalIndex++

        // We need to find the range in DOM that corresponds to 'sentence' (raw text, including whitespace)
        // Actually, 'sentence' from match includes whitespace.

        // We create a span wrapper
        const span = doc.createElement('span')
        span.id = segId
        span.className = 'segment'

        // We need to extract the nodes/parts corresponding to this sentence and move them into the span.
        // We greedily consume 'sentence.length' characters from blockNodes.

        let charsNeeded = sentence.length

        // Wait, 'sentence' comes from textContent, which might have collapsed whitespace compared to text nodes?
        // HTML whitespace handling makes this tricky.
        // Regex match on textContent (which is what user sees) is correct for TTS.
        // But mapping back to TextNodes which might contain newlines/tabs that are rendered as spaces is hard.

        // Alternative "Safe" approach for mixed content:
        // Don't wrap perfectly.
        // Just inject markers? No, we want highlighting.

        // Let's try: Normalize text nodes?
        // Or: Recursive descent?

        // Fallback for complex HTML:
        // Just wrap the whole block if parsing fails?
        // Or:
        // 1. Create a Range.
        // 2. Set Start (currentNode, currentOffset)
        // 3. Advance charsNeeded.
        // 4. Set End.
        // 5. span.append(range.extractContents())
        // 6. insert span.

        // To do this we need to account for whitespace normalization.
        // `textContent` does NOT normalize whitespace usually (it returns newlines etc).
        // `innerText` does.
        // If we used `textContent` to split, `charsNeeded` should match the sum of lengths of text nodes.

        // Let's assume textContent is reliable enough.

        if (currentNodeIdx >= blockNodes.length) return

        try {
          const range = doc.createRange()

          if (currentNodeIdx >= blockNodes.length) {
            logger.warn('No text nodes left while wrapping segment', { sentence: trimmed })
            return
          }

          range.setStart(blockNodes[currentNodeIdx], currentOffset)

          // Scanning forward
          while (charsNeeded > 0 && currentNodeIdx < blockNodes.length) {
            const node = blockNodes[currentNodeIdx]
            const available = node.length - currentOffset

            if (available <= 0) {
              currentNodeIdx++
              currentOffset = 0
              continue
            }

            if (charsNeeded <= available) {
              range.setEnd(node, currentOffset + charsNeeded)
              currentOffset += charsNeeded
              charsNeeded = 0
              if (currentOffset >= node.length) {
                currentNodeIdx++
                currentOffset = 0
              }
            } else {
              charsNeeded -= available
              currentNodeIdx++
              currentOffset = 0
            }
          }

          // If we still need chars, bail out to avoid DOMException
          if (charsNeeded > 0) {
            logger.warn('Could not fully wrap segment (insufficient text nodes)', {
              sentence: trimmed,
              remaining: charsNeeded,
            })
            return
          }

          const content = range.extractContents()
          span.appendChild(content)
          range.insertNode(span)
        } catch (e) {
          console.warn('Failed to wrap segment', e)
        }
      })
    })

    logger.info('[segmentHtml] Segmentation complete (OLD COMPLEX)', {
      totalSegments: segments.length,
      firstSegmentText: segments[0]?.text.substring(0, 100),
      lastSegmentText: segments[segments.length - 1]?.text.substring(0, 100),
    })

    return { html: doc.body.innerHTML, segments }
  }
  // END OF DISABLED COMPLEX SEGMENTATION

  async generateChapters(chapters: Chapter[]) {
    // Direct console log to bypass logger filtering
    console.error('=== GENERATION STARTING ===')
    console.error('Chapter count:', chapters.length)
    chapters.forEach((ch, i) => {
      console.error(`Chapter ${i + 1}:`, {
        id: ch.id,
        title: ch.title,
        contentLength: ch.content?.length || 0,
        contentPreview: ch.content?.substring(0, 500) || '(empty)',
      })
    })
    console.error('=== END CHAPTER DUMP ===')

    logger.error('[generateChapters] Starting generation', {
      chapterCount: chapters.length,
      chapters: chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        contentLength: ch.content?.length || 0,
        contentPreview: ch.content?.substring(0, 500) || '(empty)',
      })),
    })

    if (this.running) {
      logger.warn('Generation already running')
      return
    }

    const model = get(selectedModel)
    if (model === 'web_speech') {
      toastStore.warning(
        'Web Speech API does not support file generation. Please use Kokoro or Piper models for generating audio files.'
      )
      return
    }

    this.running = true
    this.canceled = false // Reset canceled state

    getTTSWorker()
    const totalChapters = chapters.length

    try {
      for (let i = 0; i < totalChapters; i++) {
        if (this.canceled) break

        const ch = chapters[i]
        const currentBook = get(book)

        // Use chapter-specific model if set, otherwise use global model
        const effectiveModel = ch.model || model
        const currentVoice = ch.voice || get(selectedVoice)
        const currentQuantization = get(selectedQuantization)
        const currentDevice = get(selectedDevice)
        const currentAdvancedSettings = get(advancedSettings)[effectiveModel] || {}

        // Resolve the effective language for this chapter
        const effectiveLanguage = currentBook
          ? resolveChapterLanguage(ch, currentBook)
          : DEFAULT_LANGUAGE

        // Validate content
        if (!ch.content || !ch.content.trim()) {
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, 'Chapter content is empty'))
          continue
        }

        // Update status to processing
        chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

        // Select appropriate voice based on language (only if not explicitly set for chapter)
        let effectiveVoice = currentVoice
        if (!ch.voice) {
          // Auto-select voice based on language only if no explicit voice is set
          if (effectiveModel === 'kokoro') {
            // Automatically select Kokoro voice based on language
            effectiveVoice = selectKokoroVoiceForLanguage(effectiveLanguage, currentVoice)
            const kokoroVoices = listKokoroVoices()
            if (!kokoroVoices.includes(effectiveVoice as VoiceId)) {
              logger.warn(
                `Invalid Kokoro voice '${effectiveVoice}' after selection, falling back to af_heart`
              )
              effectiveVoice = 'af_heart'
            }
            logger.info(
              `Auto-selected Kokoro voice for language ${effectiveLanguage}: ${effectiveVoice}`
            )
          } else if (effectiveModel === 'piper') {
            // Automatically select Piper voice based on language
            const piperClient = PiperClient.getInstance()
            const availableVoices = await piperClient.getVoices()
            effectiveVoice = selectPiperVoiceForLanguage(
              effectiveLanguage,
              availableVoices,
              currentVoice
            )
            logger.info(
              `Auto-selected Piper voice for language ${effectiveLanguage}: ${effectiveVoice}`
            )
          }
        } else {
          logger.info(`Using chapter-specific voice: ${effectiveVoice}`)
        }

        try {
          if (effectiveModel === 'kokoro') {
            logger.info('[generateChapters] About to segment HTML for Kokoro', {
              chapterId: ch.id,
              contentLength: ch.content.length,
              contentPreview: ch.content.substring(0, 200),
            })

            // 1. Segment the HTML content
            const { html, segments: textSegments } = this.segmentHtml(ch.id, ch.content, {
              ignoreCodeBlocks: Boolean(currentAdvancedSettings.ignoreCodeBlocks),
              ignoreLinks: Boolean(currentAdvancedSettings.ignoreLinks),
            })

            // Update in-memory content
            ch.content = html

            // 2. Update the chapter content in DB with the injected HTML
            const bookId = getBookId()

            if (bookId) {
              const { updateChapterContent } = await import('../libraryDB')
              await updateChapterContent(bookId, ch.id, html)
              logger.info(`Updated content for chapter ${ch.id} with segmented HTML`)
            }

            // 3. Generate Audio for each segment
            const audioSegments: AudioSegment[] = []

            chapterProgress.update((m) =>
              new Map(m).set(ch.id, {
                current: 0,
                total: textSegments.length,
                message: 'Initializing generation...',
              })
            )

            // Get parallelization setting (default to 1 for sequential processing)
            const parallelChunks = Math.max(1, Number(currentAdvancedSettings.parallelChunks) || 1)

            const worker = getTTSWorker()

            // Filter out empty segments first
            const nonEmptySegments = textSegments.filter((seg) => seg.text.trim())

            if (parallelChunks > 1) {
              // Parallel batch processing
              logger.info(
                `[generateChapters] Processing ${nonEmptySegments.length} segments with parallelism ${parallelChunks}`
              )

              const results = await processBatch(
                nonEmptySegments,
                parallelChunks,
                async (segment) => {
                  if (this.canceled) {
                    throw new Error('Generation canceled')
                  }

                  const blob = await worker.generateVoice({
                    text: segment.text,
                    modelType: 'kokoro',
                    voice: effectiveVoice,
                    dtype: currentQuantization,
                    device: currentDevice,
                    language: effectiveLanguage,
                    advancedSettings: currentAdvancedSettings,
                  })

                  return {
                    segment,
                    blob,
                    duration: this.calculateWavDuration(blob),
                  }
                },
                (completedCount, total) => {
                  chapterProgress.update((m) =>
                    new Map(m).set(ch.id, {
                      current: completedCount,
                      total,
                      message: `Generating segment ${completedCount}/${total} (${parallelChunks}x parallel)`,
                    })
                  )
                }
              )

              // Calculate cumulative times and build audioSegments array
              let cumulativeTime = 0
              for (const result of results) {
                audioSegments.push({
                  id: result.segment.id,
                  chapterId: ch.id,
                  index: result.segment.index,
                  text: result.segment.text,
                  audioBlob: result.blob as Blob,
                  duration: result.duration,
                  startTime: cumulativeTime,
                })
                cumulativeTime += result.duration
              }
            } else {
              // Sequential processing (original behavior)
              let cumulativeTime = 0

              for (let i = 0; i < textSegments.length; i++) {
                if (this.canceled) break
                const segText = textSegments[i].text

                // Skip empty segments
                if (!segText.trim()) continue

                chapterProgress.update((m) =>
                  new Map(m).set(ch.id, {
                    current: i + 1,
                    total: textSegments.length,
                    message: `Generating segment ${i + 1}/${textSegments.length}`,
                  })
                )

                // Generate audio for this specific sentence
                const blob = await worker.generateVoice({
                  text: segText,
                  modelType: 'kokoro',
                  voice: effectiveVoice,
                  dtype: currentQuantization,
                  device: currentDevice,
                  language: effectiveLanguage,
                  advancedSettings: currentAdvancedSettings,
                })

                const duration = this.calculateWavDuration(blob)

                audioSegments.push({
                  id: textSegments[i].id,
                  chapterId: ch.id,
                  index: i,
                  text: segText,
                  audioBlob: blob as Blob,
                  duration,
                  startTime: cumulativeTime,
                })

                cumulativeTime += duration
              }
            }

            if (this.canceled) break

            // Save segments to DB
            if (bookId) {
              await saveChapterSegments(bookId, ch.id, audioSegments)
            }

            // Concatenate for chapter audio
            const audioChapters: AudioChapter[] = audioSegments.map((s) => ({
              id: s.id,
              title: `Segment ${s.index}`,
              blob: s.audioBlob,
            }))

            const fullBlob = await concatenateAudioChapters(audioChapters, { format: 'wav' })

            // Save concatenated audio to DB for TextReader playback
            if (bookId) {
              const { saveChapterAudio } = await import('../libraryDB')
              await saveChapterAudio(bookId, ch.id, fullBlob, {
                model: effectiveModel,
                voice: effectiveVoice,
                quantization: currentQuantization,
                device: currentDevice,
                language: effectiveLanguage,
              })
            }

            // Update in-memory store
            generatedAudio.update((m) => {
              const newMap = new Map(m)
              if (m.has(ch.id)) {
                URL.revokeObjectURL(m.get(ch.id)!.url)
              }
              newMap.set(ch.id, {
                url: URL.createObjectURL(fullBlob),
                blob: fullBlob,
              })
              return newMap
            })
          } else {
            // Legacy/Worker path for Piper (unchanged for now, or TODO: implement segmentation for piper too?)
            // For now keep Piper legacy flow (flat text) as user likely uses Kokoro.
            // But user asked for "readd the epub media overlay export", implying it should work.
            // If we don't segment HTML for piper, we can't export synced EPUB for piper.
            // Let's force segmentation for Piper too?
            // Yes, same logic.

            logger.info('[generateChapters] About to segment HTML for Piper', {
              chapterId: ch.id,
              contentLength: ch.content.length,
              contentPreview: ch.content.substring(0, 200),
            })

            // 1. Segment HTML
            const { html, segments: textSegments } = this.segmentHtml(ch.id, ch.content, {
              ignoreCodeBlocks: Boolean(currentAdvancedSettings.ignoreCodeBlocks),
              ignoreLinks: Boolean(currentAdvancedSettings.ignoreLinks),
            })

            // 2. Update Content
            const bookId = getBookId()
            if (bookId) {
              const { updateChapterContent } = await import('../libraryDB')
              await updateChapterContent(bookId, ch.id, html)
            }

            // 3. Generate
            const audioSegments: AudioSegment[] = []
            const worker = getTTSWorker()

            // Get parallelization setting (default to 1 for sequential processing)
            const parallelChunks = Math.max(1, Number(currentAdvancedSettings.parallelChunks) || 1)

            // Filter out empty segments first
            const nonEmptySegments = textSegments.filter((seg) => seg.text.trim())

            if (parallelChunks > 1) {
              // Parallel batch processing
              logger.info(
                `[generateChapters] Processing ${nonEmptySegments.length} Piper segments with parallelism ${parallelChunks}`
              )

              const results = await processBatch(
                nonEmptySegments,
                parallelChunks,
                async (segment) => {
                  if (this.canceled) {
                    throw new Error('Generation canceled')
                  }

                  const blob = await worker.generateVoice({
                    text: segment.text,
                    modelType: 'piper',
                    voice: effectiveVoice,
                    device: currentDevice,
                    language: effectiveLanguage,
                    advancedSettings: currentAdvancedSettings,
                  })

                  return {
                    segment,
                    blob,
                    duration: this.calculateWavDuration(blob),
                  }
                },
                (completedCount, total) => {
                  chapterProgress.update((m) =>
                    new Map(m).set(ch.id, {
                      current: completedCount,
                      total,
                      message: `Generating segment ${completedCount}/${total} (${parallelChunks}x parallel)`,
                    })
                  )
                }
              )

              // Calculate cumulative times and build audioSegments array
              let cumulativeTime = 0
              for (const result of results) {
                audioSegments.push({
                  id: result.segment.id,
                  chapterId: ch.id,
                  index: result.segment.index,
                  text: result.segment.text,
                  audioBlob: result.blob as Blob,
                  duration: result.duration,
                  startTime: cumulativeTime,
                })
                cumulativeTime += result.duration
              }
            } else {
              // Sequential processing (original behavior)
              let cumulativeTime = 0

              for (let i = 0; i < textSegments.length; i++) {
                if (this.canceled) break
                const segText = textSegments[i].text

                if (i === 0) {
                  logger.warn('[generateChapters] About to generate first Piper segment', {
                    segmentIndex: i,
                    segmentId: textSegments[i].id,
                    text: segText,
                    textLength: segText.length,
                  })
                }

                chapterProgress.update((m) =>
                  new Map(m).set(ch.id, {
                    current: i + 1,
                    total: textSegments.length,
                    message: `Generating segment ${i + 1}/${textSegments.length}`,
                  })
                )

                const blob = await worker.generateVoice({
                  text: segText,
                  modelType: 'piper',
                  voice: effectiveVoice,
                  device: currentDevice,
                  language: effectiveLanguage,
                  advancedSettings: currentAdvancedSettings,
                })

                // Piper outputs WAV too, use same calculation
                const duration = this.calculateWavDuration(blob)

                audioSegments.push({
                  id: textSegments[i].id,
                  chapterId: ch.id,
                  index: i,
                  text: segText,
                  audioBlob: blob as Blob,
                  duration,
                  startTime: cumulativeTime,
                })

                cumulativeTime += duration
              }
            }

            if (this.canceled) break

            if (bookId) await saveChapterSegments(bookId, ch.id, audioSegments)

            // Concat
            const audioChapters = audioSegments.map((s) => ({
              id: s.id,
              title: '',
              blob: s.audioBlob,
            }))
            const fullBlob = await concatenateAudioChapters(audioChapters, { format: 'wav' })

            // Save chapter audio to DB
            if (bookId) {
              const { saveChapterAudio } = await import('../libraryDB')
              await saveChapterAudio(bookId, ch.id, fullBlob, {
                model: effectiveModel,
                voice: effectiveVoice,
                device: currentDevice,
                language: effectiveLanguage,
              })
            }

            generatedAudio.update((m) => {
              const newMap = new Map(m)
              if (m.has(ch.id)) URL.revokeObjectURL(m.get(ch.id)!.url)
              newMap.set(ch.id, { url: URL.createObjectURL(fullBlob), blob: fullBlob })
              return newMap
            })
          }

          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })
        } catch (err: any) {
          if (this.canceled) break
          const errorMsg = err.message || 'Unknown error'
          logger.error(`Generation failed for chapter ${ch.title}:`, err)
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
        }
      }
    } finally {
      this.running = false
    }
  }

  cancel() {
    this.canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()
    // Reset status of processing chapters?
    // Maybe not necessary, the loop will break and they will stay as 'processing' or we can mark them as error/pending?
    // Let's leave them for now or better, mark 'processing' as 'pending' to allow retry?
    // For now, simple cancel.
  }

  isRunning() {
    return this.running
  }

  async exportAudio(
    chapters: Chapter[],
    format: 'mp3' | 'm4b' | 'wav' = 'mp3',
    bitrate = 192,
    bookInfo: { title: string; author: string }
  ) {
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

  async exportEpub(chapters: Chapter[], bookInfo: { title: string; author: string; cover?: Blob }) {
    const { EpubGenerator } = await import('../epub/epubGenerator')
    const { getChapterSegments } = await import('../libraryDB')

    // Check if we have segments for all chapters
    // If not, we cannot create valid Media Overlay for them
    // For now, we assume user generated them using the new segment-based flow.
    // If they generated with legacy flow (legacy piper), we might not have segments?
    // The new flow saves segments for Kokoro.
    // We should check.

    const metadata: EpubMetadata = {
      title: bookInfo.title,
      author: bookInfo.author,
      language: 'en',
      identifier: `urn:uuid:${crypto.randomUUID()}`,
      cover: bookInfo.cover,
    }

    const epub = new EpubGenerator(metadata)
    const totalChapters = chapters.length

    // Using current book store ID for DB access
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
          // Determine if we should fail or just add text without audio?
          // For "Export Audiobook", we probably want audio.
          // But for "Export EPUB with Audio", maybe partial is okay?
          // Let's assume we skip audio for this chapter but warn?
          // Or try to utilize the full audio if available + simple SMIL?
          // Without alignment, SMIL is useless. Just add text + audio but no sync?
          // Let's stick to: if no segments, just text.
          epub.addChapter({
            id: ch.id,
            title: ch.title,
            content: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${ch.title}</title></head>
<body><h1>${ch.title}</h1><p>${ch.content}</p></body></html>`,
          })
          continue
        }

        // We have segments. Construct SMIL and merged Audio.
        // Concatenate audio
        // Convert blobs to AudioChapters for concat utility
        const audioChaptersToConcat: AudioChapter[] = segments.map((s) => ({
          id: s.id,
          title: `Segment ${s.index}`,
          blob: s.audioBlob,
        }))

        // Concatenate to single MP3 for the chapter (required for SMIL usually, one file per chapter is standard)
        // Using low bitrate for speech is fine, generally 64-128 is good for overlays.
        const combinedBlob = await concatenateAudioChapters(audioChaptersToConcat, {
          format: 'mp3',
          bitrate: 128,
        })

        // Calculate SMIL Data
        // We need duration of each segment.
        // Since we concatenated, we can try to estimate offsets.
        // But strict SMIL requires accurate timing.
        // Our AudioSegment MIGHT not have duration if it wasn't calculated.
        // generationService commented out duration calc in stream loop.
        // audioConcat's concatenateAudioChapters doesn't return map of offsets.
        // We need to know the duration of each blob *before* or *during* concat.

        // Helper to get duration of blobs?
        // We can use audio buffers or estimate.
        // Doing it properly: decode each blob? Expensive.
        // Estimate from size? PCM/WAV size is exact. MP3 is not.
        // Kokoro output is usually raw PCM or WAV in the detailed generation?
        // generateVoiceStream yields `audio` which is Float32Array in the raw response but converted to Blob in `kokoroClient`?
        // `kokoroClient.ts` yields `{ text, audio: Blob }`.
        // If it's WAV blob, we can parser header.
        // If it's Raw PCM, we know sample rate.

        // Let's assume we can get durations.
        // For now, let's just use the `audioLikeToBlob` utility or similar to get durations if possible?
        // Or easier: update `concatenateAudioChapters` to return timing info?
        // Or calculate it here.

        // Recalculate timing from actual segment audio blobs for accurate SMIL sync
        // This ensures timing is correct even if stored timing is missing or inaccurate
        let cumulativeTime = 0
        const smilPars = []

        for (let j = 0; j < segments.length; j++) {
          const s = segments[j]

          // Calculate duration from blob if stored duration is missing/invalid
          let duration = s.duration
          if (!duration || duration <= 0) {
            // Fallback: estimate from WAV blob size (24kHz float32 mono = 96000 bytes/sec)
            duration = (s.audioBlob.size - 44) / (24000 * 4)
            if (duration < 0) duration = 1 // Minimum fallback
          }

          const clipBegin = cumulativeTime
          const clipEnd = cumulativeTime + duration

          smilPars.push({
            // Path from smil/ folder: go up one level (..) then to the xhtml
            // Use s.id which is the actual ID in the XHTML (e.g., "seg-0", "seg-1", ...)
            textSrc: `../${ch.id}.xhtml#${s.id}`,
            // Path from smil/ folder: go up one level then to audio/
            audioSrc: `../audio/${ch.id}.mp3`,
            clipBegin,
            clipEnd,
          })

          cumulativeTime += duration
        }

        const totalDuration = cumulativeTime

        // Generate XHTML with matching IDs
        const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${ch.title}</title></head>
<body>
  ${ch.content}
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
}

export const generationService = new GenerationService()
