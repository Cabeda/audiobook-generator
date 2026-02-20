import { get } from 'svelte/store'
import type { Chapter } from '../types/book'
import type { VoiceId } from '../kokoro/kokoroVoices'
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
  isGenerating,
} from '../../stores/bookStore'
import { advancedSettings } from '../../stores/ttsStore'
import { listVoices as listKokoroVoices } from '../kokoro/kokoroVoices'
import { concatenateAudioChapters, downloadAudioFile, type AudioChapter } from '../audioConcat'
import type { EpubMetadata } from '../epub/epubGenerator'
import logger from '../utils/logger'
import { toastStore } from '../../stores/toastStore'
import { appSettings } from '../../stores/appSettingsStore'
import { saveChapterSegments, type LibraryBook } from '../libraryDB'
import type { AudioSegment } from '../types/audio'
import { resolveChapterLanguageWithDetection, DEFAULT_LANGUAGE } from '../utils/languageResolver'
import { audioService } from '../audioPlaybackService.svelte'

import {
  selectKokoroVoiceForLanguage,
  selectPiperVoiceForLanguage,
  isKokoroLanguageSupported,
  normalizeLanguageCode,
} from '../utils/voiceSelector'
import {
  initChapterSegments,
  markSegmentGenerated,
  markChapterGenerationComplete,
  setProcessingIndex,
} from '../../stores/segmentProgressStore'
import { createThrottledMapUpdater } from '../../stores/batchedStoreUpdates'

// Throttled progress updater — batches rapid segment progress updates into animation frames
const throttledProgress = createThrottledMapUpdater(chapterProgress)

/**
 * Type representing a LibraryBook with a guaranteed ID property
 */
type LibraryBookWithId = LibraryBook & { id: number }

/**
 * Helper class to batch segment saves for better performance.
 * Accumulates segments and saves them in batches to reduce database transactions.
 */
class SegmentBatchHandler {
  private batch: AudioSegment[] = []
  private readonly batchSize: number
  private readonly bookId: number | undefined
  private readonly chapterId: string

  constructor(bookId: number | undefined, chapterId: string, batchSize: number = 10) {
    this.bookId = bookId
    this.chapterId = chapterId
    this.batchSize = batchSize
  }

  /**
   * Add a segment to the batch and save if batch is full.
   * Marks the segment as generated in the UI immediately for real-time feedback.
   *
   * Note: Segments are marked as generated before batch flush for better UX.
   * If a batch flush fails, the final saveChapterSegments call (after all segments
   * are generated) will ensure all segments are eventually persisted.
   */
  async addSegment(segment: AudioSegment): Promise<void> {
    if (this.bookId) {
      this.batch.push(segment)

      // If batch is full, flush it
      if (this.batch.length >= this.batchSize) {
        try {
          await this.flush()
        } catch (error) {
          // Log the error but don't stop generation
          // The final saveChapterSegments call will ensure these segments are saved
          logger.error('Failed to flush segment batch in addSegment, continuing generation', {
            error,
            chapterId: this.chapterId,
          })
        }
      }

      // Mark segment as generated in UI immediately
      // This provides real-time feedback while batching saves for performance
      markSegmentGenerated(this.chapterId, segment)
    } else {
      // No persistent storage; just mark as generated
      markSegmentGenerated(this.chapterId, segment)
    }
  }

  /**
   * Flush any remaining segments in the batch to the database.
   * Uses `put` operations which are idempotent (upsert), so duplicate saves are safe.
   */
  async flush(): Promise<void> {
    if (this.batch.length === 0 || !this.bookId) {
      logger.debug(
        `[SegmentBatchHandler] Skipping flush: batch=${this.batch.length}, bookId=${this.bookId}`
      )
      return
    }

    try {
      logger.info(
        `[SegmentBatchHandler] Flushing ${this.batch.length} segments for chapter ${this.chapterId}, bookId=${this.bookId}`
      )
      await saveChapterSegments(this.bookId, this.chapterId, this.batch)
      logger.debug(`Flushed batch of ${this.batch.length} segments for chapter ${this.chapterId}`)
      this.batch = []
    } catch (error) {
      logger.error('Failed to save segment batch', {
        error,
        bookId: this.bookId,
        chapterId: this.chapterId,
        batchSize: this.batch.length,
      })
      // Clear batch even on error to avoid retry loops
      // The final saveChapterSegments call will ensure these segments are saved
      this.batch = []
      throw error
    }
  }
}

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

export interface SegmentOptions {
  ignoreCodeBlocks?: boolean
  ignoreLinks?: boolean
}

/**
 * Read a Blob (or a slice of it) as a Uint8Array.
 * Works in both browser and jsdom test environments where
 * Blob.arrayBuffer() or Blob.slice().arrayBuffer() may be missing.
 */
async function readBlobAsUint8Array(blob: Blob, maxBytes?: number): Promise<Uint8Array> {
  const target = maxBytes != null && maxBytes < blob.size ? blob.slice(0, maxBytes) : blob

  // Try the modern API first
  if (typeof target.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await target.arrayBuffer())
    } catch {
      // fall through
    }
  }

  // Fallback: FileReader (works in jsdom)
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
      } else {
        reject(new Error('FileReader did not return ArrayBuffer'))
      }
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader error'))
    reader.readAsArrayBuffer(target)
  })
}

/**
 * Parse a WAV blob header and return the accurate duration in seconds.
 * Handles arbitrary chunk layouts (extra LIST/fact/etc. chunks before data).
 *
 * This replaces the old hardcoded `(blob.size - 44) / (24000 * 4)` estimate
 * which assumed 24 kHz float32 mono and caused highlight-audio desync when
 * the actual format differed (e.g. 16-bit PCM, different sample rates).
 */
export async function parseWavDuration(blob: Blob): Promise<number> {
  const headerBytes = await readBlobAsUint8Array(blob, 1024)
  const view = new DataView(headerBytes.buffer)

  // Validate RIFF/WAVE
  const riff = String.fromCharCode(...headerBytes.slice(0, 4))
  const wave = String.fromCharCode(...headerBytes.slice(8, 12))
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    // Not a valid WAV — fall back to blob-size estimate (24kHz 16-bit mono)
    const fallback = (blob.size - 44) / (24000 * 2)
    return fallback > 0 ? fallback : 0
  }

  let offset = 12
  let sampleRate = 24000
  let numChannels = 1
  let bitsPerSample = 16
  let dataLength = -1

  while (offset + 8 <= headerBytes.length) {
    const chunkId = String.fromCharCode(...headerBytes.slice(offset, offset + 4))
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataLength = chunkSize
      break
    }

    offset += 8 + chunkSize
  }

  if (dataLength <= 0) {
    // Could not find data chunk — fall back using parsed fmt values
    const fallback = (blob.size - 44) / (sampleRate * (bitsPerSample / 8) * numChannels)
    return fallback > 0 ? fallback : 0
  }

  const bytesPerSec = sampleRate * (bitsPerSample / 8) * numChannels
  return bytesPerSec > 0 ? dataLength / bytesPerSec : 0
}

export function segmentHtmlContent(
  chapterId: string,
  htmlContent: string,
  options: SegmentOptions = {}
): { html: string; segments: { index: number; text: string; id: string }[] } {
  const segments: { index: number; text: string; id: string }[] = []

  logger.info('[segmentHtml] Starting HTML segmentation with pre-wrapping', {
    chapterId,
    htmlLength: htmlContent.length,
    ignoreCodeBlocks: !!options.ignoreCodeBlocks,
    ignoreLinks: !!options.ignoreLinks,
  })

  // Use DOMParser to parse and modify the HTML
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')

  // Strip existing segment spans to prevent double-wrapping on regeneration.
  // This handles the case where ch.content was mutated in a previous generation run.
  doc.querySelectorAll('span.segment').forEach((span) => {
    const parent = span.parentNode
    if (parent) {
      // Move all children out of the span, then remove the empty span
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span)
      }
      parent.removeChild(span)
    }
  })
  // Normalize adjacent text nodes that were split by span removal
  doc.body.normalize()

  // Remove elements we want to skip
  if (options.ignoreCodeBlocks) {
    doc.querySelectorAll('pre, code').forEach((el) => el.remove())
  }
  if (options.ignoreLinks) {
    doc.querySelectorAll('a').forEach((el) => el.remove())
  }

  // Helper function to split text into sentences
  const splitIntoSentences = (text: string): string[] => {
    const parts: string[] = []
    // Pattern: sentence ending punctuation followed by space(s) and capital letter (or end)
    const sentenceEndRegex = /([.!?]+)(\s+)(?=[A-Z]|$)/g

    let lastIndex = 0
    let match

    sentenceEndRegex.lastIndex = 0

    while ((match = sentenceEndRegex.exec(text)) !== null) {
      const sentence = text.slice(lastIndex, match.index + match[1].length).trim()
      if (sentence) {
        parts.push(sentence)
      }
      lastIndex = match.index + match[1].length + match[2].length
    }

    // Add any remaining text
    if (lastIndex < text.length) {
      const sentence = text.slice(lastIndex).trim()
      if (sentence) {
        parts.push(sentence)
      }
    }

    // If no splits were made, return the whole text as one sentence
    if (parts.length === 0 && text.trim()) {
      return [text.trim()]
    }

    return parts
  }

  // Helper to wrap a sentence even if it spans multiple text nodes (with inline elements)
  const wrapSentenceInBlock = (
    block: Element,
    sentence: string,
    segmentId: string,
    segmentIndex: number
  ): boolean => {
    // Collect all text nodes in document order within the block
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, null)
    const textNodes: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && node.textContent.trim()) {
        textNodes.push(node)
      }
    }

    // Build a string of the block's text content, mapping each character to its text node and offset
    let fullText = ''
    const charMap: { node: Text; offset: number }[] = []
    for (const tn of textNodes) {
      for (let i = 0; i < tn.textContent!.length; i++) {
        fullText += tn.textContent![i]
        charMap.push({ node: tn, offset: i })
      }
    }

    // Try to find the sentence in the fullText (normalize whitespace for both)
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const normFull = norm(fullText)
    const normSentence = norm(sentence)
    const idx = normFull.indexOf(normSentence)
    if (idx === -1) return false

    // Map normalized index back to original char indices
    let normIdx = 0,
      origIdx = 0
    const normToOrig: number[] = []
    while (origIdx < fullText.length) {
      if (/\s/.test(fullText[origIdx])) {
        if (normFull[normIdx] === ' ') {
          normToOrig.push(origIdx)
          while (origIdx < fullText.length && /\s/.test(fullText[origIdx])) origIdx++
          normIdx++
        } else {
          origIdx++
        }
      } else {
        normToOrig.push(origIdx)
        origIdx++
        normIdx++
      }
    }

    const startOrig = normToOrig[idx]
    const endOrig = normToOrig[idx + normSentence.length - 1] + 1

    // Find the start and end text node/offset for the sentence
    let startNode: Text | null = null,
      startOffset = 0
    let endNode: Text | null = null,
      endOffset = 0
    let charCount = 0
    for (const tn of textNodes) {
      const len = tn.textContent!.length
      if (!startNode && startOrig < charCount + len) {
        startNode = tn
        startOffset = startOrig - charCount
      }
      if (!endNode && endOrig <= charCount + len) {
        endNode = tn
        endOffset = endOrig - charCount
        break
      }
      charCount += len
    }
    if (!startNode || !endNode) return false

    // Use a Range to extract the DOM fragment for the sentence
    const range = doc.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)

    // Clone the contents (preserving inline elements)
    const frag = range.cloneContents()

    // Create the wrapper span
    const span = doc.createElement('span')
    span.id = segmentId
    span.className = 'segment'
    span.setAttribute('data-segment-index', String(segmentIndex))
    span.appendChild(frag)

    // Replace the range in the DOM with the span
    range.deleteContents()
    range.insertNode(span)

    return true
  }

  // Process block elements and wrap sentences directly in the DOM
  // Only select leaf block elements (not containers like section/article/div)
  let blockElements = Array.from(
    doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, code')
  )

  // Fallback: if no block elements found, treat body's direct children or body itself as blocks
  // This handles plain text or content wrapped in non-semantic divs
  if (blockElements.length === 0) {
    // Check for divs or spans that contain text
    const divElements = doc.body.querySelectorAll('div, span')
    if (divElements.length > 0) {
      blockElements = Array.from(divElements)
    } else {
      // Last resort: treat body itself as the block
      blockElements = [doc.body]
    }
  }

  let segmentIndex = 0
  const processedElements = new Set<Element>()

  // Process each block element
  blockElements.forEach((block) => {
    // Skip if this element is nested inside another block we've already processed
    let parent = block.parentElement
    let skip = false
    while (parent && parent !== doc.body) {
      if (processedElements.has(parent)) {
        skip = true
        break
      }
      parent = parent.parentElement
    }

    if (skip) return

    const blockText = (block.textContent || '').trim()
    if (!blockText) return

    // Get sentences for this block
    const blockSentences = splitIntoSentences(blockText)

    // For each sentence, find and wrap it in the DOM
    for (const sentence of blockSentences) {
      const segmentId = `seg-${segmentIndex}`

      // Try to find and wrap this sentence in the block's text nodes
      let wrapped = false

      // Try to wrap the sentence, even if it spans multiple text nodes (with inline elements)
      wrapped = wrapSentenceInBlock(block, sentence, segmentId, segmentIndex)

      // Only create a segment if we successfully wrapped it
      if (wrapped) {
        segments.push({
          index: segmentIndex,
          text: sentence,
          id: segmentId,
        })
        segmentIndex++
      } else {
        // Log warning but still create segment for audio generation
        // The text will be spoken but not highlighted
        logger.warn(`[segmentHtml] Could not wrap segment in DOM: "${sentence.slice(0, 50)}..."`)
        segments.push({
          index: segmentIndex,
          text: sentence,
          id: segmentId,
        })
        segmentIndex++
      }
    }

    processedElements.add(block)
  })

  // Get the modified HTML with wrapped segments
  const wrappedHtml = doc.body.innerHTML

  logger.info('[segmentHtml] Segmentation complete with pre-wrapped segments', {
    totalSegments: segments.length,
    firstSegmentText: segments[0]?.text.substring(0, 100),
    wrappedHtmlLength: wrappedHtml.length,
  })

  return { html: wrappedHtml, segments }
}

class GenerationService {
  private running = false
  private canceled = false
  private canceledChapters = new Set<string>()

  private wakeLock: WakeLockSentinel | null = null
  private priorityOverrides = new Map<string, number>()

  // Auto-play settings for seamless mobile experience
  private autoPlayEnabled = false
  private autoPlayTriggered = new Set<string>() // Track chapters where auto-play was already triggered

  /**
   * Enable or disable auto-play of first segment when generation starts
   * Auto-play provides seamless listening experience on mobile
   */
  setAutoPlay(enabled: boolean) {
    this.autoPlayEnabled = enabled
    logger.info(`Auto-play ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Set the next segment to be processed for a chapter.
   * This allows the user to click a segment and prioritize its generation,
   * continuing sequentially from there.
   */
  setGenerationPriority(chapterId: string, segmentIndex: number) {
    // Only accept if we are running
    if (this.running) {
      this.priorityOverrides.set(chapterId, segmentIndex)
      logger.info(`Set generation priority for chapter ${chapterId} to segment ${segmentIndex}`)
    }
  }

  // Bind the handler so it can be added/removed as an event listener
  private handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && this.running) {
      logger.info('Page became visible, re-acquiring wake lock')
      await this.requestWakeLock()
    }
  }

  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen')
        logger.info('Screen Wake Lock acquired')
      } else {
        logger.warn('Screen Wake Lock API not supported/available')
      }
    } catch (err) {
      logger.warn('Failed to acquire Screen Wake Lock', err)
    }
  }

  private async releaseWakeLock() {
    try {
      if (this.wakeLock) {
        await this.wakeLock.release()
        this.wakeLock = null
        logger.info('Screen Wake Lock released')
      }
    } catch (err) {
      logger.warn('Failed to release Screen Wake Lock', err)
    }
  }

  // Silent audio helpers to prevent background throttling
  private audioContext: AudioContext | null = null
  private silentOscillator: OscillatorNode | null = null
  private silentGainNode: GainNode | null = null

  private async startSilentAudio() {
    try {
      // Stop any existing silent audio to ensure clean state
      await this.stopSilentAudio()

      if (typeof window === 'undefined') return

      const AudioContextClass =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return

      this.audioContext = new AudioContextClass()

      // Create a silent oscillator
      // browsers might optimize away purely silent (gain 0) audio, so we use near-zero gain
      this.silentGainNode = this.audioContext.createGain()
      this.silentGainNode.gain.value = 0.0001 // Inaudible but active
      this.silentGainNode.connect(this.audioContext.destination)

      this.silentOscillator = this.audioContext.createOscillator()
      this.silentOscillator.type = 'sine'
      this.silentOscillator.frequency.value = 440
      this.silentOscillator.connect(this.silentGainNode)
      this.silentOscillator.start()

      logger.info('Silent audio started to prevent background throttling')
    } catch (err) {
      logger.warn('Failed to start silent audio', err)
    }
  }

  private async stopSilentAudio() {
    try {
      if (this.silentOscillator) {
        try {
          this.silentOscillator.stop()
        } catch {
          // Ignore stop errors; oscillator may already be stopped
        }
        this.silentOscillator.disconnect()
        this.silentOscillator = null
      }

      if (this.silentGainNode) {
        try {
          this.silentGainNode.disconnect()
        } catch {
          // Ignore disconnect errors; node may already be disconnected
        }
        this.silentGainNode = null
      }

      if (this.audioContext) {
        await this.audioContext.close().catch((e) => logger.warn('Failed to close AudioContext', e))
        this.audioContext = null
      }
      logger.info('Silent audio stopped')
    } catch (err) {
      logger.warn('Failed to stop silent audio', err)
    }
  }

  /**
   * Calculate duration of a WAV blob by parsing its header.
   *
   * Previous implementation hardcoded 24 kHz / float32 / mono which caused
   * duration mis-estimates (and therefore highlight desync) whenever the
   * actual WAV format differed — e.g. 16-bit PCM from Kokoro's toBlob(),
   * Piper at 22050 Hz, or the audioBufferToWav helper which writes 16-bit.
   *
   * The async variant reads the first 1 KB of the blob to locate the "fmt "
   * and "data" chunks so it works regardless of extra chunks (LIST, fact, …).
   * A synchronous fast-path is kept for callers that only have blob.size.
   */
  private calculateWavDuration(blob: Blob): number {
    // Synchronous fallback: use the most common output format (24 kHz 16-bit mono)
    // This is only used as the return value; the async path below is preferred
    // when the caller can await, but both call-sites currently use the sync return.
    // We parse the header synchronously via the blob size heuristic but with the
    // correct default bytes-per-sample for PCM-16.
    const headerSize = 44
    const sampleRate = 24000
    const bytesPerSample = 2 // 16-bit PCM (most common output)
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

  /**
   * Process segments with dynamic priority handling.
   * Replaces strict sequential/batch processing.
   *
   * @param chapterId Chapter ID for priority lookup
   * @param segments List of segments to process
   * @param getParallelism Function that returns current parallelism level (re-read each batch)
   * @param processor Function to process a single segment
   * @param onResult Function to handle the result (e.g. saving to DB)
   * @param onProgress Function to report progress
   */
  private async processSegmentsWithPriority<T, R>(
    chapterId: string,
    segments: T[],
    getParallelism: () => number,
    processor: (segment: T) => Promise<R>,
    onResult: (result: R) => Promise<void>,
    onProgress: (completed: number, total: number) => void
  ) {
    const total = segments.length
    const processed = new Set<number>()
    const failed = new Set<number>()
    let cursor = 0 // Start at beginning

    // Main loop: Continue until all segments are processed or canceled
    while (processed.size + failed.size < total && !this.canceled) {
      const batch: T[] = []
      const batchIndices = new Set<number>()

      // Re-read parallelism each batch so user changes take effect immediately
      const parallelism = getParallelism()

      // Fill batch with next available segments
      while (batch.length < parallelism && processed.size + failed.size + batch.length < total) {
        let nextIndex: number | undefined

        // 1. Check for priority override
        if (this.priorityOverrides.has(chapterId)) {
          const priority = this.priorityOverrides.get(chapterId)!
          if (
            priority >= 0 &&
            priority < total &&
            !processed.has(priority) &&
            !failed.has(priority) &&
            !batchIndices.has(priority)
          ) {
            nextIndex = priority
            cursor = (priority + 1) % total
            this.priorityOverrides.delete(chapterId)
          } else {
            this.priorityOverrides.delete(chapterId)
          }
        }

        // 2. Fallback to cursor logic if no valid priority
        if (nextIndex === undefined) {
          let checked = 0
          while (
            (processed.has(cursor) || failed.has(cursor) || batchIndices.has(cursor)) &&
            checked < total
          ) {
            cursor = (cursor + 1) % total
            checked++
          }

          if (checked < total) {
            nextIndex = cursor
            cursor = (cursor + 1) % total
          }
        }

        if (nextIndex !== undefined) {
          const seg = segments[nextIndex]
          if (seg) {
            batch.push(seg)
            batchIndices.add(nextIndex)
          } else {
            logger.warn(`Segment at index ${nextIndex} not found`)
            failed.add(nextIndex)
          }
        } else {
          break
        }
      }

      if (batch.length === 0) break

      // Update the currently-processing index so the UI can pulse the right segment
      const batchIndexArray = Array.from(batchIndices)
      setProcessingIndex(chapterId, batchIndexArray[0])

      // Process batch — handle individual failures without losing the whole batch
      const results = await Promise.allSettled(
        batch.map(async (seg) => {
          if (this.canceled) throw new Error('Generation canceled')
          return await processor(seg)
        })
      )

      if (this.canceled) break

      // Handle results: successful ones go to onResult, failed ones are tracked
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const idx = batchIndexArray[i]

        if (result.status === 'fulfilled' && result.value) {
          try {
            await onResult(result.value)
            processed.add(idx)
          } catch (err) {
            logger.error(`Failed to handle result for segment ${idx}:`, err)
            failed.add(idx)
          }
        } else if (result.status === 'rejected') {
          logger.error(`Segment ${idx} generation failed:`, result.reason)
          failed.add(idx)
        } else {
          // fulfilled with null (e.g. empty segment) — mark as processed
          processed.add(idx)
        }
      }

      onProgress(processed.size, total)
    }

    if (failed.size > 0) {
      logger.warn(
        `[processSegments] ${failed.size}/${total} segments failed for chapter ${chapterId}`,
        {
          failedIndices: Array.from(failed),
        }
      )
    }
  }

  /**
   * Generate audio for a single chapter starting from a specific segment index.
   * This is used when clicking a segment in the reader to start generation from that point.
   * After reaching the end, it will generate all missing segments to ensure complete audio.
   *
   * @param chapter - The chapter to generate
   * @param startSegmentIndex - The segment index to start from (0-based)
   * @param totalSegments - Optional total number of segments for immediate progress display
   */
  async generateSingleChapterFromSegment(
    chapter: Chapter,
    startSegmentIndex: number = 0,
    totalSegments?: number,
    bookId?: number
  ) {
    if (this.running) {
      logger.warn('Generation already running')
      toastStore.warning('Generation is already running')
      return
    }

    logger.info(`Starting generation for chapter ${chapter.id} from segment ${startSegmentIndex}`)

    // Immediately set status to 'processing' so UI updates before async work begins
    chapterStatus.update((m) => new Map(m).set(chapter.id, 'processing'))

    // If we know the total segments, initialize segment progress immediately for better UX
    if (totalSegments && totalSegments > 0) {
      // Create placeholder segments with the known count
      const placeholderSegments = Array.from({ length: totalSegments }, (_, i) => ({
        text: '',
        id: `${chapter.id}-seg-${i}`,
        index: i,
      }))
      initChapterSegments(chapter.id, placeholderSegments)
      logger.info(`Pre-initialized ${totalSegments} segments for immediate UI feedback`)
    } else {
      // Fallback: Set initial progress message for immediate UI feedback
      chapterProgress.update((m) =>
        new Map(m).set(chapter.id, {
          current: 0,
          total: 1,
          message: 'Starting generation from segment...',
        })
      )
    }

    // Set priority for this chapter and segment
    this.priorityOverrides.set(chapter.id, startSegmentIndex)

    // Use the existing generateChapters method which handles priorities
    await this.generateChapters([chapter], bookId)
  }

  async generateChapters(chapters: Chapter[], explicitBookId?: number) {
    logger.info('[generateChapters] Starting generation', {
      chapterCount: chapters.length,
      chapters: chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        contentLength: ch.content?.length || 0,
      })),
    })

    if (this.running) {
      logger.warn('Generation already running')
      return
    }

    const model = get(selectedModel)

    this.running = true
    this.canceled = false // Reset canceled state
    this.canceledChapters.clear() // Reset per-chapter cancellation
    this.autoPlayTriggered.clear() // Reset auto-play triggers for new generation
    isGenerating.set(true)

    // Acquire wake lock to prevent device sleep
    await this.requestWakeLock()
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    // Start silent audio to prevent CPU throttling in background
    await this.startSilentAudio()

    getTTSWorker()
    const totalChapters = chapters.length

    try {
      for (let i = 0; i < totalChapters; i++) {
        if (this.canceled) break

        const ch = chapters[i]

        // Skip chapters that were individually canceled
        if (this.canceledChapters.has(ch.id)) {
          logger.info(`[generateChapters] Skipping canceled chapter ${ch.id}`)
          continue
        }

        const currentBook = get(book)

        // Resolve the effective language for this chapter (with auto-detection support)
        const effectiveLanguage = currentBook
          ? resolveChapterLanguageWithDetection(ch, currentBook)
          : DEFAULT_LANGUAGE

        // Check app-level per-language defaults (priority: chapter > app language defaults > global)
        const langDefaults = appSettings.getLanguageDefault(get(appSettings), effectiveLanguage)

        // Resolve model: chapter override > app language default > global selected model
        // Fallback: If current model doesn't support the language, try to switch
        let effectiveModel = ch.model || langDefaults?.model || model
        let isFallbackModel = false

        if (effectiveModel === 'kokoro' && !isKokoroLanguageSupported(effectiveLanguage)) {
          logger.warn(
            `Language '${effectiveLanguage}' not supported by Kokoro. Switching to Piper for chapter ${ch.id}`
          )
          effectiveModel = 'piper'
          isFallbackModel = true
        }

        const currentVoice = ch.voice || langDefaults?.voice || get(selectedVoice)
        const currentQuantization = get(selectedQuantization)
        const currentDevice = get(selectedDevice)
        const currentAdvancedSettings = get(advancedSettings)[effectiveModel] || {}

        // Validate content
        if (!ch.content || !ch.content.trim()) {
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, 'Chapter content is empty'))
          continue
        }

        // Update status to processing
        chapterStatus.update((m) => new Map(m).set(ch.id, 'processing'))

        // Select appropriate voice based on language
        let effectiveVoice = currentVoice

        // We determine if we need to auto-select a voice.
        // Auto-select if:
        // 1. Current voice is invalid/missing (!currentVoice)
        // 2. OR we fell back to a different model AND the user's voice is not valid for the fallback model
        // Note: If the user explicitly set a chapter voice that's valid for the fallback model, respect it
        let shouldAutoSelectVoice = !currentVoice
        if (!shouldAutoSelectVoice && isFallbackModel) {
          // Only auto-select if the user's voice isn't valid for the fallback model
          if (effectiveModel === 'piper') {
            const { PiperClient } = await import('../piper/piperClient')
            const piperClient = PiperClient.getInstance()
            const voices = await piperClient.getVoices()
            const isValidForPiper = voices.some((v: { key: string }) => v.key === currentVoice)
            shouldAutoSelectVoice = !isValidForPiper
          } else {
            shouldAutoSelectVoice = true
          }
        }

        if (shouldAutoSelectVoice) {
          // Auto-select voice based on language
          // If fallback happened, we ignore 'currentVoice' as a preference because it's likely for the wrong model (e.g. Kokoro voice 'af_heart' when we want Piper)
          const preferredVoice = isFallbackModel ? undefined : currentVoice

          if (effectiveModel === 'kokoro') {
            // Automatically select Kokoro voice based on language
            effectiveVoice = selectKokoroVoiceForLanguage(effectiveLanguage, preferredVoice)
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
            const { PiperClient } = await import('../piper/piperClient')
            const piperClient = PiperClient.getInstance()
            const availableVoices = await piperClient.getVoices()
            effectiveVoice = selectPiperVoiceForLanguage(
              effectiveLanguage,
              availableVoices,
              preferredVoice
            )
            logger.info(
              `Auto-selected Piper voice for language ${effectiveLanguage}: ${effectiveVoice}`
            )
          }
        } else {
          logger.info(`Using chapter-specific voice: ${effectiveVoice}`)
        }

        // If a specific Piper voice is selected from the GLOBAL default (not a chapter override)
        // but doesn't match the detected language, switch to a matching one.
        // We skip this check when the user explicitly set a chapter voice — respect their choice.
        if (effectiveModel === 'piper' && !shouldAutoSelectVoice && !ch.voice) {
          const { PiperClient } = await import('../piper/piperClient')
          const piperClient = PiperClient.getInstance()
          const availableVoices = await piperClient.getVoices()
          const selectedVoiceInfo = availableVoices.find(
            (v: { key: string }) => v.key === effectiveVoice
          )
          const normalizedChapterLang = normalizeLanguageCode(effectiveLanguage)
          const voiceLang = selectedVoiceInfo
            ? normalizeLanguageCode(selectedVoiceInfo.language)
            : null

          const voiceMatchesLanguage = selectedVoiceInfo && voiceLang === normalizedChapterLang

          if (!voiceMatchesLanguage) {
            logger.warn(
              `Selected Piper voice '${effectiveVoice}' is not compatible with language '${effectiveLanguage}', auto-switching`,
              {
                chapterId: ch.id,
                detectedLanguage: effectiveLanguage,
                selectedVoice: effectiveVoice,
                selectedVoiceLanguage: selectedVoiceInfo?.language,
              }
            )

            effectiveVoice = selectPiperVoiceForLanguage(
              effectiveLanguage,
              availableVoices,
              undefined
            )

            logger.info(
              `Switched Piper voice to '${effectiveVoice}' for language '${effectiveLanguage}'`
            )
          }
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
            const bookId = explicitBookId ?? getBookId()
            logger.info(
              `[generateChapters] bookId for chapter ${ch.id}: ${bookId} (explicit: ${explicitBookId}, from store: ${getBookId()})`
            )

            if (bookId) {
              const { updateChapterContent } = await import('../libraryDB')
              await updateChapterContent(bookId, ch.id, html)
              logger.info(`Updated content for chapter ${ch.id} with segmented HTML`)
            }

            // Initialize segment progress tracking for live UI updates
            initChapterSegments(ch.id, textSegments)

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
            const getParallelChunks = () =>
              Math.max(1, Number(get(advancedSettings)[effectiveModel]?.parallelChunks) || 1)

            const worker = getTTSWorker()

            // Create batch handler for efficient database writes
            const batchHandler = new SegmentBatchHandler(bookId, ch.id, 10)

            await this.processSegmentsWithPriority(
              ch.id,
              textSegments,
              getParallelChunks,
              async (segment) => {
                if (this.canceled || this.canceledChapters.has(ch.id))
                  throw new Error('Generation canceled')

                // Skip empty segments
                if (!segment.text.trim()) return null

                const blob = await worker.generateVoice({
                  text: segment.text,
                  modelType: 'kokoro',
                  voice: effectiveVoice,
                  dtype: currentQuantization,
                  device: currentDevice,
                  language: effectiveLanguage,
                  advancedSettings: currentAdvancedSettings,
                })

                const duration = await parseWavDuration(blob)

                return {
                  segment,
                  blob,
                  duration,
                }
              },
              async (result) => {
                if (!result) return
                const segment: AudioSegment = {
                  id: result.segment.id,
                  chapterId: ch.id,
                  index: result.segment.index,
                  text: result.segment.text,
                  audioBlob: result.blob as Blob,
                  duration: result.duration,
                  startTime: 0, // Placeholder, fixed after sort
                }
                audioSegments.push(segment)
                await batchHandler.addSegment(segment)

                // Auto-play first segment for seamless mobile experience
                // Only triggers once per chapter, on the first completed segment
                if (
                  this.autoPlayEnabled &&
                  !this.autoPlayTriggered.has(ch.id) &&
                  !this.canceled &&
                  !this.canceledChapters.has(ch.id)
                ) {
                  this.autoPlayTriggered.add(ch.id)
                  logger.info(`[AutoPlay] Starting playback of first available segment`, {
                    chapterId: ch.id,
                    segmentIndex: segment.index,
                  })
                  // Use setTimeout to avoid blocking the generation loop
                  // Re-check canceled inside callback to prevent playing after cancellation
                  setTimeout(() => {
                    if (this.canceled || this.canceledChapters.has(ch.id)) {
                      logger.info('[AutoPlay] Skipped — generation was canceled')
                      return
                    }
                    audioService.playSingleSegment(segment).catch((err) => {
                      logger.warn('[AutoPlay] Failed to auto-play first segment:', err)
                    })
                  }, 0)
                }
              },
              (completed, total) => {
                throttledProgress.set(ch.id, {
                  current: completed,
                  total,
                  message: `Generating segment ${completed}/${total}`,
                })
              }
            )

            await batchHandler.flush()

            // Sort audio segments by index and fix start times
            audioSegments.sort((a, b) => a.index - b.index)
            let cumulativeTime = 0
            for (const s of audioSegments) {
              s.startTime = cumulativeTime
              cumulativeTime += s.duration || 0
            }

            if (this.canceled || this.canceledChapters.has(ch.id)) break

            // Mark chapter generation as complete
            markChapterGenerationComplete(ch.id)

            // Save all chapter segments to DB as a complete batch snapshot.
            // This serves as a safety net to ensure all segments are persisted,
            // even if some progressive batches failed during generation.
            // Uses `put` operations which are idempotent, so duplicate saves are safe.
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
            const bookId = explicitBookId ?? getBookId()
            if (bookId) {
              const { updateChapterContent } = await import('../libraryDB')
              await updateChapterContent(bookId, ch.id, html)
            }

            // Initialize segment progress tracking for live UI updates
            initChapterSegments(ch.id, textSegments)

            // 3. Generate
            const audioSegments: AudioSegment[] = []
            const worker = getTTSWorker()

            // Get parallelization setting (default to 1 for sequential processing)
            const getParallelChunksPiper = () =>
              Math.max(1, Number(get(advancedSettings)[effectiveModel]?.parallelChunks) || 1)

            // Create batch handler for efficient database writes
            const batchHandler = new SegmentBatchHandler(bookId, ch.id, 10)

            await this.processSegmentsWithPriority(
              ch.id,
              textSegments,
              getParallelChunksPiper,
              async (segment) => {
                if (this.canceled || this.canceledChapters.has(ch.id))
                  throw new Error('Generation canceled')

                // Skip empty segments
                if (!segment.text.trim()) return null

                const blob = await worker.generateVoice({
                  text: segment.text,
                  modelType: effectiveModel as import('../tts/ttsModels').TTSModelType,
                  voice: effectiveVoice,
                  device: currentDevice,
                  language: effectiveLanguage,
                  advancedSettings: currentAdvancedSettings,
                  // No dtype for Piper/Kitten
                })

                const duration = await parseWavDuration(blob)

                return {
                  segment,
                  blob,
                  duration,
                }
              },
              async (result) => {
                if (!result) return
                const segment: AudioSegment = {
                  id: result.segment.id,
                  chapterId: ch.id,
                  index: result.segment.index,
                  text: result.segment.text,
                  audioBlob: result.blob as Blob,
                  duration: result.duration,
                  startTime: 0, // Placeholder, fixed after sort
                }
                audioSegments.push(segment)
                await batchHandler.addSegment(segment)

                // Auto-play first segment for seamless mobile experience
                // Only triggers once per chapter, on the first completed segment
                if (
                  this.autoPlayEnabled &&
                  !this.autoPlayTriggered.has(ch.id) &&
                  !this.canceled &&
                  !this.canceledChapters.has(ch.id)
                ) {
                  this.autoPlayTriggered.add(ch.id)
                  logger.info(`[AutoPlay/Piper] Starting playback of first available segment`, {
                    chapterId: ch.id,
                    segmentIndex: segment.index,
                  })
                  setTimeout(() => {
                    if (this.canceled || this.canceledChapters.has(ch.id)) {
                      logger.info('[AutoPlay/Piper] Skipped — generation was canceled')
                      return
                    }
                    audioService.playSingleSegment(segment).catch((err) => {
                      logger.warn('[AutoPlay/Piper] Failed to auto-play first segment:', err)
                    })
                  }, 0)
                }
              },
              (completed, total) => {
                throttledProgress.set(ch.id, {
                  current: completed,
                  total,
                  message: `Generating segment ${completed}/${total}`,
                })
              }
            )

            await batchHandler.flush()

            // Sort audio segments by index and fix start times
            audioSegments.sort((a, b) => a.index - b.index)
            let cumulativeTime = 0
            for (const s of audioSegments) {
              s.startTime = cumulativeTime
              cumulativeTime += s.duration || 0
            }

            if (this.canceled || this.canceledChapters.has(ch.id)) break

            // Mark chapter generation as complete
            markChapterGenerationComplete(ch.id)

            // Save all chapter segments to DB as a complete batch snapshot.
            // This serves as a safety net to ensure all segments are persisted,
            // even if some progressive batches failed during generation.
            // Uses `put` operations which are idempotent, so duplicate saves are safe.
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

          // Flush any pending throttled progress updates before marking done
          throttledProgress.flush()
          chapterStatus.update((m) => new Map(m).set(ch.id, 'done'))
          chapterErrors.update((m) => {
            const newMap = new Map(m)
            newMap.delete(ch.id)
            return newMap
          })
        } catch (err: unknown) {
          if (this.canceled) break
          if (this.canceledChapters.has(ch.id)) continue
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          logger.error(`Generation failed for chapter ${ch.title}:`, err)
          chapterStatus.update((m) => new Map(m).set(ch.id, 'error'))
          chapterErrors.update((m) => new Map(m).set(ch.id, errorMsg))
        }
      }
    } finally {
      throttledProgress.flush()
      this.running = false
      isGenerating.set(false)

      // Clean up silent audio
      await this.stopSilentAudio()

      // Clean up wake lock and listener
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      await this.releaseWakeLock()
    }
  }

  cancel() {
    this.canceled = true
    const worker = getTTSWorker()
    worker.cancelAll()

    // Reset status of processing chapters to pending so UI spinners stop
    const statusMap = get(chapterStatus)
    const newStatusMap = new Map(statusMap)
    let changed = false

    for (const [id, status] of statusMap.entries()) {
      if (status === 'processing') {
        newStatusMap.set(id, 'pending') // Reset to pending to allow retry
        changed = true
      }
    }

    if (changed) {
      chapterStatus.set(newStatusMap)
    }

    // Clear auto-play state for canceled chapters
    this.autoPlayTriggered.clear()
    this.canceledChapters.clear()

    this.running = false
    isGenerating.set(false)
  }

  /**
   * Cancel generation for a single chapter without stopping the entire batch.
   * The generation loop will skip this chapter and continue with the next one.
   */
  cancelChapter(chapterId: string) {
    this.canceledChapters.add(chapterId)
    logger.info(`[CancelChapter] Marked chapter ${chapterId} for cancellation`)

    // Reset chapter status to pending
    chapterStatus.update((m) => {
      const newMap = new Map(m)
      if (newMap.get(chapterId) === 'processing') {
        newMap.set(chapterId, 'pending')
      }
      return newMap
    })

    // Mark generation as no longer in progress for this chapter
    markChapterGenerationComplete(chapterId)
  }

  isRunning() {
    return this.running
  }

  /**
   * Pre-generate first chapter in the background for faster listening experience
   * This is useful for mobile users who want to start listening immediately
   *
   * @param chapters - All chapters in the book
   * @param options - Pre-generation options
   */
  async preGenerateFirstChapter(
    chapters: Chapter[],
    options: {
      /** Maximum segments to pre-generate (default: 3 for quick preview) */
      maxSegments?: number
      /** Skip if already generated */
      skipIfGenerated?: boolean
    } = {}
  ) {
    const { maxSegments = 3, skipIfGenerated = true } = options

    if (chapters.length === 0) {
      logger.info('[PreGenerate] No chapters to pre-generate')
      return
    }

    const firstChapter = chapters[0]

    // Check if chapter already has audio
    if (skipIfGenerated) {
      const currentStatus = get(chapterStatus).get(firstChapter.id)
      if (currentStatus === 'done') {
        logger.info('[PreGenerate] First chapter already generated, skipping')
        return
      }

      // Also check if any audio exists in the generated store
      const generated = get(generatedAudio)
      if (generated.has(firstChapter.id)) {
        logger.info('[PreGenerate] First chapter already has audio, skipping')
        return
      }
    }

    // Don't pre-generate if generation is already running
    if (this.running) {
      logger.info('[PreGenerate] Generation already in progress, skipping pre-generation')
      return
    }

    logger.info('[PreGenerate] Starting background pre-generation of first chapter', {
      chapterId: firstChapter.id,
      title: firstChapter.title,
      maxSegments,
    })

    // For now, we start full generation which will auto-play the first segment
    // In the future, we could add a limited-segment mode
    // Disable auto-play during pre-generation since user hasn't explicitly requested playback
    const wasAutoPlayEnabled = this.autoPlayEnabled
    this.setAutoPlay(false)

    try {
      await this.generateChapters([firstChapter])
    } catch (err) {
      logger.warn('[PreGenerate] Background pre-generation failed:', err)
    } finally {
      // Restore auto-play setting
      this.setAutoPlay(wasAutoPlayEnabled)
    }
  }

  async exportAudio(
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
<body><h1>${ch.title}</h1>${ch.content.replace(/&nbsp;/g, '&#160;')}</body></html>`,
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
            // Fallback: parse WAV header for accurate duration
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
        // Replace HTML entities not valid in XHTML (e.g. &nbsp; → &#160;)
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
}

export const generationService = new GenerationService()
