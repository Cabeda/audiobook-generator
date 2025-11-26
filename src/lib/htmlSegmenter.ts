import DOMPurify from 'dompurify'

export interface ProcessedHtml {
  html: string
  segments: string[]
}

interface SegmentRange {
  start: number
  end: number
  text: string
}

/**
 * Process HTML content to inject segment markers for highlighting
 * and extract text segments for TTS.
 */
export function processHtmlAndGetSegments(htmlContent: string): ProcessedHtml {
  // First sanitize the HTML
  const cleanHtml = DOMPurify.sanitize(htmlContent, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'img',
      'figure',
      'figcaption',
      'div',
      'span',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id'],
    ADD_ATTR: ['data-segment-index'],
  })

  if (typeof window === 'undefined') {
    return { html: cleanHtml, segments: [] }
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(cleanHtml, 'text/html')

  const segments: string[] = []
  let currentSegmentIndex = 0

  // Process top-level elements as blocks to ensure correct segmentation boundaries
  const children = Array.from(doc.body.childNodes)

  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.TEXT_NODE) {
      processBlock(child, segments, currentSegmentIndex)
      currentSegmentIndex = segments.length
    }
  }

  return {
    html: doc.body.innerHTML,
    segments,
  }
}

function processBlock(root: Node, segments: string[], startIndex: number) {
  const text = root.textContent || ''
  if (!text.trim()) return

  // Find segments and their ranges in the block text
  const ranges = findSegmentRanges(text)

  if (ranges.length === 0) return

  // Collect all text nodes in this block
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  // Map ranges to nodes and wrap them
  let currentNodeIndex = 0
  let currentTextOffset = 0 // Offset of the current node's start in the block text

  for (const range of ranges) {
    segments.push(range.text.trim())
    const segmentIndex = startIndex + segments.length - 1

    // We need to wrap content from range.start to range.end
    let remainingStart = range.start
    let remainingEnd = range.end

    // Advance to the first node involved in this range
    while (currentNodeIndex < textNodes.length) {
      const node = textNodes[currentNodeIndex]
      const nodeLength = node.textContent?.length || 0
      const nodeEndOffset = currentTextOffset + nodeLength

      if (nodeEndOffset <= remainingStart) {
        // This node is entirely before the segment
        currentTextOffset += nodeLength
        currentNodeIndex++
        continue
      }

      // Node overlaps with segment
      break
    }

    // Process nodes involved in the segment
    while (currentNodeIndex < textNodes.length && remainingStart < remainingEnd) {
      const node = textNodes[currentNodeIndex]
      const nodeLength = node.textContent?.length || 0
      const nodeEndOffset = currentTextOffset + nodeLength

      // Calculate overlap
      const startInNode = Math.max(0, remainingStart - currentTextOffset)
      const endInNode = Math.min(nodeLength, remainingEnd - currentTextOffset)

      if (startInNode < endInNode) {
        // We have content to wrap in this node

        // If we need to split the node
        let targetNode = node

        // Handle split at end first (to keep indices valid relative to start)
        if (endInNode < nodeLength) {
          const remainder = targetNode.splitText(endInNode)
          // Insert remainder into our list so we process it correctly later
          textNodes.splice(currentNodeIndex + 1, 0, remainder)
        }

        // Handle split at start
        if (startInNode > 0) {
          targetNode = targetNode.splitText(startInNode)
          // The previous part is done, we are wrapping the new part
          // We need to update currentTextOffset because we effectively skipped the first part
          currentTextOffset += startInNode
          // But wait, our loop logic relies on currentTextOffset being the start of the *original* node
          // This gets messy if we modify the list we are iterating.
        }

        // Wrap targetNode
        const span = document.createElement('span')
        span.className = 'segment'
        span.dataset.segmentIndex = segmentIndex.toString()
        // Set ID only for the first part of the segment
        if (remainingStart === range.start) {
          span.id = `segment-${segmentIndex}`
        }

        targetNode.parentNode?.insertBefore(span, targetNode)
        span.appendChild(targetNode)

        // Update state
        remainingStart += endInNode - startInNode
      }

      // Move to next node if we consumed this one (or split it)
      // If we split at start, targetNode is the second part.
      // If we split at end, we inserted remainder.

      // Simpler logic:
      // Since we are modifying DOM, calculating offsets is hard.
      // But we know the ranges are sequential.

      // Let's just advance.
      currentTextOffset = nodeEndOffset // This assumes we processed the whole node or split parts sum up
      currentNodeIndex++
    }
  }
}

function findSegmentRanges(text: string): SegmentRange[] {
  const ranges: SegmentRange[] = []
  const regex = /([.!?])(\s+|$)/g
  let match
  let lastIndex = 0

  while ((match = regex.exec(text)) !== null) {
    const end = match.index + 1 // Include terminator
    const segmentText = text.substring(lastIndex, end)

    if (segmentText.trim()) {
      ranges.push({
        start: lastIndex,
        end: end,
        text: segmentText,
      })
    }

    lastIndex = match.index + match[0].length // Skip terminator and whitespace
  }

  // Handle remaining text
  if (lastIndex < text.length) {
    const segmentText = text.substring(lastIndex)
    if (segmentText.trim()) {
      ranges.push({
        start: lastIndex,
        end: text.length,
        text: segmentText,
      })
    }
  }

  return ranges
}
