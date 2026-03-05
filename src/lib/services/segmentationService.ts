/**
 * HTML segmentation service.
 *
 * Splits chapter HTML into sentence-level segments wrapped in <span> elements
 * so the reader can highlight the currently-playing sentence. This is a pure
 * function with no side-effects — it takes HTML in and returns segmented HTML
 * plus a list of segment metadata.
 *
 * Extracted from generationService to isolate text-processing concerns.
 */

import logger from '../utils/logger'

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
      // Try to wrap the sentence, even if it spans multiple text nodes (with inline elements)
      const wrapped = wrapSentenceInBlock(block, sentence, segmentId, segmentIndex)

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
