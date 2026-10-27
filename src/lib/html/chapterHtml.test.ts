import { describe, it, expect } from 'vitest'
import {
  sanitizeChapterHtml,
  sanitizeChapterBody,
  isSafeChapterUrl,
  htmlToText,
} from './chapterHtml'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

describe('isSafeChapterUrl', () => {
  it('keeps http, https and relative URLs', () => {
    expect(isSafeChapterUrl('https://example.com/a.png')).toBe(true)
    expect(isSafeChapterUrl('images/a.png')).toBe(true)
    expect(isSafeChapterUrl('#anchor')).toBe(true)
  })

  it('rejects the schemes that execute', () => {
    expect(isSafeChapterUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeChapterUrl('JaVaScRiPt:alert(1)')).toBe(false)
    expect(isSafeChapterUrl('java%73cript:alert(1)')).toBe(false)
    expect(isSafeChapterUrl('vbscript:msgbox(1)')).toBe(false)
  })

  it('rejects data URLs unless they are images and the caller allows it', () => {
    expect(isSafeChapterUrl(PNG)).toBe(false)
    expect(isSafeChapterUrl(PNG, { allowDataImage: true })).toBe(true)
    expect(isSafeChapterUrl('data:text/html;base64,PHNjcmlwdD4=', { allowDataImage: true })).toBe(
      false
    )
    expect(
      isSafeChapterUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', { allowDataImage: true })
    ).toBe(false)
  })
})

describe('sanitizeChapterHtml', () => {
  it('keeps the structure a chapter is made of', () => {
    const html =
      '<h2>Steps</h2><ul><li>One</li><li>Two</li></ul><table><tr><th>Name</th></tr><tr><td>Bob</td></tr></table>'
    const clean = sanitizeChapterHtml(html)

    expect(clean).toContain('<h2>Steps</h2>')
    expect(clean).toContain('<li>One</li>')
    expect(clean).toContain('<th>Name</th>')
    expect(clean).toContain('<td>Bob</td>')
  })

  it('keeps an inlined image and its alt text', () => {
    const clean = sanitizeChapterHtml(`<img src="${PNG}" alt="A diagram">`)

    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="')
    expect(clean).toContain('alt="A diagram"')
  })

  it('removes scripts, handlers and link scripts', () => {
    const clean = sanitizeChapterHtml(
      '<p onclick="steal()">text</p><script>alert(1)</script><img src="x" onerror="steal()"><a href="javascript:alert(1)">link</a>'
    )

    expect(clean).not.toContain('script')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('text')
    expect(clean).toContain('link')
  })

  it('drops source styling so the reader styles the chapter', () => {
    const clean = sanitizeChapterHtml('<p class="x" style="color:red">text</p>')

    expect(clean).toBe('<p>text</p>')
  })

  it('keeps segment ids and drops the rest', () => {
    const clean = sanitizeChapterHtml('<span id="seg-3">a</span><span id="footnote">b</span>')

    expect(clean).toContain('id="seg-3"')
    expect(clean).not.toContain('footnote')
  })
})

describe('sanitizeChapterBody', () => {
  it('sanitizes a body element in place', () => {
    const doc = new DOMParser().parseFromString('<p><script>x()</script>text</p>', 'text/html')
    sanitizeChapterBody(doc.body)

    expect(doc.body.innerHTML).toBe('<p>text</p>')
  })
})

describe('htmlToText', () => {
  it('reads the words of a chapter', () => {
    expect(htmlToText('<h1>Title</h1><p>Hello <em>world</em>.</p>')).toBe('Title Hello world.')
  })

  it('does not glue blocks together', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one two')
    expect(htmlToText('<li>a</li><li>b</li>')).toBe('a b')
  })

  it('drops script and style bodies', () => {
    expect(htmlToText('<style>p{}</style><p>word</p><script>var x</script>')).toBe('word')
  })

  it('reads plain text, as stored by older books', () => {
    expect(htmlToText('Just some text.\n\nAnother line.')).toBe('Just some text. Another line.')
  })

  it('is empty for empty input', () => {
    expect(htmlToText('')).toBe('')
    expect(htmlToText('<p> </p>')).toBe('')
  })
})
