/**
 * PDF layout reconstruction.
 *
 * A PDF has no paragraphs, lists or tables: it has glyphs at coordinates.
 * pdf.js hands back a stream of text items, each with a position and a font
 * size, and this turns them into the blocks a chapter is made of — lines, then
 * paragraphs, headings, list items, code runs and tables.
 *
 * It is a reconstruction, not a parse: every rule here is a heuristic over
 * geometry. The rules are kept together and pure so they can be tested without
 * a PDF file and tuned when a document proves them wrong.
 */

import type { Book, Chapter } from '../types/book'

/** Gap between two runs on one baseline that reads as a column, not a word. */
const COLUMN_GAP = 12

/** Two baselines closer than this are the same line. */
const BASELINE_TOLERANCE = 2

/** In-sentence line spacing, relative to the page's median, still one paragraph. */
const PARAGRAPH_GAP_FACTOR = 1.45

/** A heading is this much larger than the body text. */
const HEADING_SIZE_FACTOR = 1.25

/** Columns line up within this many points, or they are not columns. */
const COLUMN_ALIGNMENT_TOLERANCE = 6

const BLOCKS_PER_CHAPTER_FALLBACK = 10

export interface PdfTextItem {
  str: string
  height: number
  /** `[a, b, c, d, x, y]` — x and y are at index 4 and 5. */
  transform: number[]
  width?: number
  fontName?: string
}

export interface PdfPageInput {
  pageNum: number
  items: PdfTextItem[]
}

export interface PdfSegment {
  text: string
  x: number
  xEnd: number
}

export interface PdfLine {
  page: number
  y: number
  x: number
  xEnd: number
  size: number
  font: string
  text: string
  /** Runs separated by a column-sized gap. Two or more means a row. */
  segments: PdfSegment[]
}

export type PdfBlock =
  | { kind: 'heading'; level: number; text: string; page: number }
  | { kind: 'paragraph'; text: string; page: number; x: number }
  | { kind: 'list'; ordered: boolean; items: string[]; page: number }
  | { kind: 'pre'; text: string; page: number }
  | { kind: 'table'; rows: string[][]; page: number }

const BULLET_MARKER = /^(?:[•·◦▪‣∙※]|[-–—*])\s+/
const NUMBER_MARKER = /^(?:\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,4}[.)])\s+/

/** Is this line an item of a bullet or numbered list? */
export function listMarker(text: string): { ordered: boolean; body: string } | null {
  const ordered = NUMBER_MARKER.exec(text)
  if (ordered) return { ordered: true, body: text.slice(ordered[0].length) }
  const bullet = BULLET_MARKER.exec(text)
  if (bullet) return { ordered: false, body: text.slice(bullet[0].length) }
  return null
}

/** Group text items into lines, in reading order. */
export function buildLines(pages: PdfPageInput[]): PdfLine[] {
  const lines: PdfLine[] = []

  for (const page of pages) {
    const items = page.items
      .filter((item) => item.str.trim().length > 0 && item.height > 0)
      .map((item) => ({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        size: item.height,
        font: item.fontName ?? '',
        width: item.width ?? item.str.length * item.height * 0.5,
      }))
      .sort((a, b) => b.y - a.y || a.x - b.x)

    // Baselines are not exactly equal between runs, so group by proximity:
    // the first item of a line sets the baseline the rest are compared to.
    let group: typeof items = []
    let groupY = Number.NaN
    const flush = () => {
      if (group.length === 0) return
      lines.push(makeLine(page.pageNum, group))
      group = []
    }

    for (const item of items) {
      if (group.length === 0) {
        groupY = item.y
      } else if (Math.abs(groupY - item.y) > BASELINE_TOLERANCE) {
        flush()
        groupY = item.y
      }
      group.push(item)
    }
    flush()
  }

  return lines
}

interface RawRun {
  text: string
  x: number
  y: number
  size: number
  font: string
  width: number
}

function makeLine(page: number, items: RawRun[]): PdfLine {
  const ordered = [...items].sort((a, b) => a.x - b.x)
  const segments: PdfSegment[] = []

  for (const item of ordered) {
    const previous = segments[segments.length - 1]
    const startsNewColumn = previous && item.x - previous.xEnd >= COLUMN_GAP
    if (!previous || startsNewColumn) {
      segments.push({ text: item.text.trim(), x: item.x, xEnd: item.x + item.width })
    } else {
      previous.text = joinText(previous.text, item.text)
      previous.xEnd = Math.max(previous.xEnd, item.x + item.width)
    }
  }

  const sizes = new Map<number, number>()
  const fonts = new Map<string, number>()
  for (const item of ordered) {
    const weight = item.text.trim().length
    sizes.set(item.size, (sizes.get(item.size) ?? 0) + weight)
    fonts.set(item.font, (fonts.get(item.font) ?? 0) + weight)
  }

  return {
    page,
    y: items[0].y,
    x: ordered[0].x,
    xEnd: Math.max(...segments.map((segment) => segment.xEnd)),
    size: largest(sizes),
    font: largest(fonts),
    text: segments.reduce(
      (text, segment) => (text ? joinText(text, segment.text) : segment.text),
      ''
    ),
    segments,
  }
}

function largest<T extends string | number>(counts: Map<T, number>): T {
  let best: T | undefined
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best as T
}

/** Join two runs, keeping a hyphenated word whole and other words spaced. */
function joinText(left: string, right: string): string {
  const a = left.trimEnd()
  const b = right.trimStart()
  if (!a) return b
  if (!b) return a
  return a.endsWith('-') ? `${a}${b}` : `${a} ${b}`
}

/**
 * Fonts that advance the same width per character, which is what a code block
 * looks like on the page — PDF font names say nothing useful on their own.
 */
export function detectMonospaceFonts(pages: PdfPageInput[]): Set<string> {
  const widths = new Map<string, number[]>()

  for (const page of pages) {
    for (const item of page.items) {
      const text = item.str.trim()
      if (!item.fontName || text.length < 4 || !item.width) continue
      const samples = widths.get(item.fontName) ?? []
      samples.push(item.width / text.length)
      widths.set(item.fontName, samples)
    }
  }

  const mono = new Set<string>()
  for (const [font, samples] of widths) {
    if (samples.length < 6) continue
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
    if (mean <= 0) continue
    const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length
    if (Math.sqrt(variance) / mean <= 0.06) mono.add(font)
  }
  return mono
}

/** The gap between consecutive lines that counts as normal line spacing. */
export function medianLineGap(lines: PdfLine[]): number {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].page !== lines[i - 1].page) continue
    const gap = lines[i - 1].y - lines[i].y
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return 0
  gaps.sort((a, b) => a - b)
  // Lower median: paragraph breaks are the gap the body text does not use.
  return gaps[Math.floor((gaps.length - 1) / 2)]
}

/** Turn lines into the blocks a chapter is made of. */
export function buildBlocks(lines: PdfLine[], monoFonts: Set<string> = new Set()): PdfBlock[] {
  // Body text is the size most of the words are set in; a document's headings
  // are large but there are few of them.
  const bodySize = dominantSize(lines) || 12
  const headingSizes = [
    ...new Set(
      lines
        .filter((l) => l.size >= bodySize * HEADING_SIZE_FACTOR)
        .map((line) => roundSize(line.size))
    ),
  ].sort((a, b) => b - a)

  const levelOf = (size: number): number | null => {
    const rounded = roundSize(size)
    if (rounded < bodySize * HEADING_SIZE_FACTOR) return null
    // Sizes cluster loosely: a heading a point smaller is still the same level.
    const index = headingSizes.findIndex((candidate) => Math.abs(candidate - rounded) <= 1)
    return index === -1 ? null : Math.min(index + 1, 6)
  }

  const gap = medianLineGap(lines)
  const normalGap = gap > 0 ? gap : bodySize * 1.2
  const blocks: PdfBlock[] = []

  let paragraph: string[] = []
  let paragraphLine: PdfLine | null = null
  let list: { ordered: boolean; items: string[]; page: number; x: number; last: PdfLine } | null =
    null
  let pre: { lines: string[]; page: number; last: PdfLine } | null = null
  let rows: PdfLine[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({
      kind: 'paragraph',
      text: paragraph.join(' '),
      page: paragraphLine?.page ?? lines[0]?.page ?? 1,
      x: paragraphLine?.x ?? 0,
    })
    paragraph = []
    paragraphLine = null
  }

  const flushList = () => {
    if (!list) return
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items, page: list.page })
    list = null
  }

  const flushPre = () => {
    if (!pre) return
    blocks.push({ kind: 'pre', text: pre.lines.join('\n'), page: pre.page })
    pre = null
  }

  const flushRows = () => {
    if (rows.length === 0) return
    const table = tableFromRows(rows)
    if (table) {
      blocks.push(table)
    } else {
      // Row-shaped but not aligned: each line is its own block, which is what a
      // labelled list looks like when its values do not line up in a column.
      for (const row of rows) {
        blocks.push({ kind: 'paragraph', text: row.text, page: row.page, x: row.x })
      }
    }
    rows = []
  }

  const flushAll = () => {
    flushParagraph()
    flushList()
    flushPre()
    flushRows()
  }

  for (const line of lines) {
    const level = levelOf(line.size)
    const marker = listMarker(line.text)
    const isPre = monoFonts.has(line.font)
    const isRow = !level && !marker && !isPre && line.segments.length >= 2
    const gapFrom = (previous: PdfLine) =>
      previous.page === line.page ? previous.y - line.y : Number.POSITIVE_INFINITY
    const continues = (previous: PdfLine) => gapFrom(previous) <= normalGap * PARAGRAPH_GAP_FACTOR

    // A line that belongs to the block already open continues it.
    if (pre && isPre && continues(pre.last)) {
      pre.lines.push(line.text)
      pre.last = line
      continue
    }

    if (list) {
      if (marker && marker.ordered === list.ordered && line.page === list.page) {
        list.items.push(marker.body)
        list.last = line
        continue
      }
      const indented = line.x > list.x + 4
      if (!marker && !level && !isRow && indented && continues(list.last)) {
        list.items[list.items.length - 1] = joinText(list.items[list.items.length - 1], line.text)
        list.last = line
        continue
      }
    }

    if (rows.length > 0 && isRow && line.page === rows[0].page) {
      rows.push(line)
      continue
    }

    if (
      paragraph.length > 0 &&
      paragraphLine &&
      !level &&
      !marker &&
      !isPre &&
      !isRow &&
      Math.abs(line.x - paragraphLine.x) <= 3 &&
      continues(paragraphLine)
    ) {
      paragraph.push(line.text)
      paragraphLine = line
      continue
    }

    // Nothing open takes this line, so close what came before it.
    flushAll()

    if (level) {
      blocks.push({ kind: 'heading', level, text: line.text, page: line.page })
    } else if (marker) {
      list = {
        ordered: marker.ordered,
        items: [marker.body],
        page: line.page,
        x: line.x,
        last: line,
      }
    } else if (isPre) {
      pre = { lines: [line.text], page: line.page, last: line }
    } else if (isRow) {
      rows = [line]
    } else {
      paragraph = [line.text]
      paragraphLine = line
    }
  }

  flushAll()
  return blocks
}

/** A run of row-shaped lines becomes a table only when its columns line up. */
function tableFromRows(rows: PdfLine[]): PdfBlock | null {
  if (rows.length < 2) return null
  const columns = rows[0].segments.length
  if (columns < 2) return null
  if (rows.some((row) => row.segments.length !== columns)) return null

  for (let column = 0; column < columns; column++) {
    const starts = rows.map((row) => row.segments[column].x)
    if (Math.max(...starts) - Math.min(...starts) > COLUMN_ALIGNMENT_TOLERANCE) return null
  }

  return {
    kind: 'table',
    rows: rows.map((row) => row.segments.map((segment) => segment.text)),
    page: rows[0].page,
  }
}

/** The HTML a chapter's blocks make. */
export function blocksToHtml(blocks: PdfBlock[]): string {
  return blocks.map(blockToHtml).join('\n')
}

function blockToHtml(block: PdfBlock): string {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 6)
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const items = block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
      return `<${tag}>${items}</${tag}>`
    }
    case 'pre':
      return `<pre>${escapeHtml(block.text)}</pre>`
    case 'table': {
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')
      return `<table>${rows}</table>`
    }
  }
}

/**
 * The Book a PDF's pages make.
 *
 * Chapters split at the shallowest heading level the document uses: a report
 * with one title and many sections is one chapter, a book with chapter headings
 * is many. With no headings at all, group by pages as a last resort.
 */
export function pagesToBook(
  pages: PdfPageInput[],
  meta: { title?: string; author?: string }
): Book {
  const blocks = buildBlocks(buildLines(pages), detectMonospaceFonts(pages))
  const headings = blocks.filter(
    (block): block is Extract<PdfBlock, { kind: 'heading' }> => block.kind === 'heading'
  )
  const chapterLevel = headings.reduce((lowest, block) => Math.min(lowest, block.level), Infinity)

  const chapters = Number.isFinite(chapterLevel)
    ? splitAtHeadings(blocks, chapterLevel)
    : splitByPages(blocks)

  const firstHeading = headings[0]
  const title = meta.title?.trim() || firstHeading?.text || 'Untitled PDF'

  return {
    title,
    author: meta.author?.trim() || 'Unknown',
    chapters: chapters.length > 0 ? chapters : [{ id: 'chapter-1', title, content: '' }],
    format: 'pdf',
  }
}

function splitAtHeadings(blocks: PdfBlock[], level: number): Chapter[] {
  const chapters: Chapter[] = []
  let current: { title: string; blocks: PdfBlock[] } | null = null

  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === level) {
      if (current) chapters.push(toChapter(current.title, current.blocks, chapters.length))
      current = { title: block.text, blocks: [] }
      continue
    }
    if (current) current.blocks.push(block)
  }
  if (current) chapters.push(toChapter(current.title, current.blocks, chapters.length))

  return chapters.filter((chapter) => chapter.content.length > 0)
}

function toChapter(title: string, blocks: PdfBlock[], index: number): Chapter {
  return { id: `chapter-${index + 1}`, title, content: blocksToHtml(blocks) }
}

function splitByPages(blocks: PdfBlock[]): Chapter[] {
  const chapters: Chapter[] = []
  for (let i = 0; i < blocks.length; i += BLOCKS_PER_CHAPTER_FALLBACK) {
    const group = blocks.slice(i, i + BLOCKS_PER_CHAPTER_FALLBACK)
    const first = group[0].page
    const last = group[group.length - 1].page
    chapters.push({
      id: `pages-${first}-${last}`,
      title: first === last ? `Page ${first}` : `Pages ${first}-${last}`,
      content: blocksToHtml(group),
    })
  }
  return chapters
}

/** The size that carries the most characters. Ties go to the smaller size. */
function dominantSize(lines: PdfLine[]): number {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const size = roundSize(line.size)
    weight.set(size, (weight.get(size) ?? 0) + line.text.length)
  }

  let best = 0
  let bestWeight = -1
  for (const [size, characters] of weight) {
    if (characters > bestWeight || (characters === bestWeight && size < best)) {
      best = size
      bestWeight = characters
    }
  }
  return best
}

function roundSize(size: number): number {
  return Math.round(size * 10) / 10
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
