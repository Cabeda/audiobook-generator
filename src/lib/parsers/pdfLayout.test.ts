import { describe, it, expect } from 'vitest'
import {
  blocksToHtml,
  buildBlocks,
  buildLines,
  detectMonospaceFonts,
  listMarker,
  medianLineGap,
  pagesToBook,
  type PdfPageInput,
  type PdfTextItem,
} from './pdfLayout'

/** A text item as pdf.js reports it: string, size, and where it sits. */
function item(
  str: string,
  x: number,
  y: number,
  options: { size?: number; font?: string; width?: number } = {}
): PdfTextItem {
  const size = options.size ?? 10
  return {
    str,
    height: size,
    transform: [size, 0, 0, size, x, y],
    width: options.width ?? str.length * size * 0.5,
    fontName: options.font ?? 'Body',
  }
}

function page(items: PdfTextItem[], pageNum = 1): PdfPageInput {
  return { pageNum, items }
}

describe('buildLines', () => {
  it('puts a line back together from runs that arrive out of order', () => {
    const lines = buildLines([
      page([item('spike', 120, 700), item('This is a', 40, 700), item('research', 75, 700)]),
    ])

    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('This is a research spike')
  })

  it('treats runs within a couple of points as one line', () => {
    const lines = buildLines([page([item('one', 40, 700), item('two', 80, 701.2)])])

    expect(lines).toHaveLength(1)
  })

  it('keeps a column apart from the sentence next to it', () => {
    const lines = buildLines([
      page([item('Verdict:', 40, 700), item('Feasible', 200, 700, { width: 40 })]),
    ])

    expect(lines[0].segments).toHaveLength(2)
    expect(lines[0].segments[1].text).toBe('Feasible')
  })

  it('joins a hyphenated word without a stray space', () => {
    const lines = buildLines([page([item('a merge-', 40, 700), item('approval rule', 100, 700)])])

    expect(lines[0].text).toBe('a merge-approval rule')
  })

  it('ignores empty and zero-height items', () => {
    const lines = buildLines([
      page([item('text', 40, 700), item('  ', 60, 700), { ...item('', 80, 700), height: 0 }]),
    ])

    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('text')
  })

  it('reads pages in order, top to bottom', () => {
    const lines = buildLines([page([item('bottom', 40, 600), item('top', 40, 700)])])

    expect(lines.map((line) => line.text)).toEqual(['top', 'bottom'])
  })
})

describe('listMarker', () => {
  it('recognises bullets and numbers', () => {
    expect(listMarker('• First point')).toEqual({ ordered: false, body: 'First point' })
    expect(listMarker('- Second point')).toEqual({ ordered: false, body: 'Second point' })
    expect(listMarker('1. First step')).toEqual({ ordered: true, body: 'First step' })
    expect(listMarker('b) Second step')).toEqual({ ordered: true, body: 'Second step' })
  })

  it('leaves prose alone', () => {
    expect(listMarker('Item one is prose')).toBeNull()
    expect(listMarker('2024 was a year')).toBeNull()
  })
})

describe('detectMonospaceFonts', () => {
  it('finds the font that advances the same width per character', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) =>
        item(`path/to/thing-${i}`, 40, 700 - i * 10, { font: 'Mono', width: 15 * 4.5 })
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        item('This is a sentence with varied letters', 40, 600 - i * 10, {
          font: 'Body',
          width: 30 + i * 9,
        })
      ),
    ]

    const mono = detectMonospaceFonts([page(items)])

    expect(mono.has('Mono')).toBe(true)
    expect(mono.has('Body')).toBe(false)
  })
})

describe('medianLineGap', () => {
  it('reports the usual spacing between lines', () => {
    const lines = buildLines([
      page([item('one', 40, 700), item('two', 40, 690), item('three', 40, 680)]),
    ])

    expect(medianLineGap(lines)).toBe(10)
  })
})

describe('buildBlocks', () => {
  it('merges wrapped lines into one paragraph and breaks on a gap', () => {
    const blocks = buildBlocks(
      buildLines([
        page([
          item('The first line of the paragraph', 40, 700),
          item('continues here', 40, 690),
          item('A new paragraph after a gap', 40, 660),
        ]),
      ])
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      text: 'The first line of the paragraph continues here',
    })
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', text: 'A new paragraph after a gap' })
  })

  it('ranks headings by size', () => {
    const blocks = buildBlocks(
      buildLines([
        page([
          item('Document title', 40, 700, { size: 24 }),
          item('A section', 40, 660, { size: 18 }),
          item('Body text here', 40, 640),
        ]),
      ])
    )

    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1, text: 'Document title' })
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2, text: 'A section' })
  })

  it('collects consecutive items into one list', () => {
    const blocks = buildBlocks(
      buildLines([
        page([
          item('1. First step', 40, 700),
          item('2. Second step', 40, 690),
          item('3. Third step', 40, 680),
        ]),
      ])
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'list',
      ordered: true,
      items: ['First step', 'Second step', 'Third step'],
    })
  })

  it('keeps a wrapped list item together', () => {
    const blocks = buildBlocks(
      buildLines([page([item('• A point that runs on', 40, 700), item('and wraps here', 60, 690)])])
    )

    expect(blocks[0]).toMatchObject({
      kind: 'list',
      items: ['A point that runs on and wraps here'],
    })
  })

  it('builds a table when the columns line up', () => {
    const blocks = buildBlocks(
      buildLines([
        page([
          item('Name', 40, 700, { width: 30 }),
          item('Age', 200, 700, { width: 20 }),
          item('Bob', 40, 690, { width: 20 }),
          item('42', 200, 690, { width: 12 }),
        ]),
      ])
    )

    expect(blocks[0]).toMatchObject({
      kind: 'table',
      rows: [
        ['Name', 'Age'],
        ['Bob', '42'],
      ],
    })
  })

  it('does not invent a table when the columns wander', () => {
    const blocks = buildBlocks(
      buildLines([
        page([
          item('Item one:', 40, 700, { width: 40 }),
          item('Feasible', 200, 700, { width: 40 }),
          item('Item two:', 40, 690, { width: 50 }),
          item('Proposals only', 230, 690, { width: 70 }),
        ]),
      ])
    )

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph'])
    expect(blocksToHtml(blocks)).toContain('<p>Item one: Feasible</p>')
  })

  it('collects a monospace run into one code block', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      item(`group/repo-${i}`, 40, 700 - i * 10, { font: 'Mono', width: 11 * 4.5 })
    )
    const pages = [page(items)]

    const blocks = buildBlocks(buildLines(pages), detectMonospaceFonts(pages))

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'pre',
      text: 'group/repo-0\ngroup/repo-1\ngroup/repo-2\ngroup/repo-3\ngroup/repo-4\ngroup/repo-5',
    })
  })
})

describe('blocksToHtml', () => {
  it('escapes text instead of trusting it', () => {
    const html = blocksToHtml([{ kind: 'paragraph', text: 'a < b & c', page: 1, x: 0 }])

    expect(html).toBe('<p>a &lt; b &amp; c</p>')
  })

  it('writes each block as the element it is', () => {
    const html = blocksToHtml([
      { kind: 'heading', level: 2, text: 'Title', page: 1 },
      { kind: 'list', ordered: false, items: ['one'], page: 1 },
      { kind: 'table', rows: [['a', 'b']], page: 1 },
      { kind: 'pre', text: 'code', page: 1 },
    ])

    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<ul><li>one</li></ul>')
    expect(html).toContain('<table><tr><td>a</td><td>b</td></tr></table>')
    expect(html).toContain('<pre>code</pre>')
  })
})

describe('pagesToBook', () => {
  const reportPages = (): PdfPageInput[] => [
    page([
      item('Quarterly Report', 40, 750, { size: 22 }),
      item('Summary', 40, 700, { size: 15 }),
      item('The summary explains what happened.', 40, 680),
      item('Risks', 40, 640, { size: 15 }),
      item('The risks are listed here.', 40, 620),
    ]),
  ]

  it('makes one chapter of a document with a single title', () => {
    const book = pagesToBook(reportPages(), {})

    expect(book.title).toBe('Quarterly Report')
    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0].title).toBe('Quarterly Report')
    expect(book.chapters[0].content).toContain('<h2>Summary</h2>')
    expect(book.chapters[0].content).toContain('<h2>Risks</h2>')
    // The title is the chapter's name, so it is not repeated inside it.
    expect(book.chapters[0].content).not.toContain('Quarterly Report')
  })

  it('splits a book with chapter headings into chapters', () => {
    const book = pagesToBook(
      [
        page([
          item('Chapter One', 40, 750, { size: 20 }),
          item('First chapter text.', 40, 720),
          item('Chapter Two', 40, 650, { size: 20 }),
          item('Second chapter text.', 40, 620),
        ]),
      ],
      { title: 'Collected Works', author: 'A. Writer' }
    )

    expect(book.title).toBe('Collected Works')
    expect(book.author).toBe('A. Writer')
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['Chapter One', 'Chapter Two'])
    expect(book.chapters[1].content).toContain('Second chapter text.')
  })

  it('falls back to page groups when there is no heading at all', () => {
    const book = pagesToBook([page([item('Just a line of text.', 40, 700)])], {})

    expect(book.chapters).toHaveLength(1)
    expect(book.chapters[0].title).toBe('Page 1')
    expect(book.format).toBe('pdf')
  })

  it('uses the metadata title over the document heading', () => {
    const book = pagesToBook(reportPages(), { title: 'Annual Report' })

    expect(book.title).toBe('Annual Report')
    expect(book.chapters[0].title).toBe('Quarterly Report')
  })
})
