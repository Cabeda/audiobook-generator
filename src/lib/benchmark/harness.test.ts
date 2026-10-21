import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { benchmarkConfig, segmentBook } from './harness'

const book = readFileSync(resolve(process.cwd(), 'books/test-short.epub'))

describe('benchmarkConfig', () => {
  it('runs Kokoro on the CPU, so the comparison is fair', () => {
    expect(benchmarkConfig('kokoro')).toEqual({
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      dtype: 'q8',
      device: 'wasm',
    })
  })

  it('leaves the other engines on their own settings', () => {
    expect(benchmarkConfig('piper')).toEqual({})
    expect(benchmarkConfig('pocket')).toEqual({})
  })
})

describe('segmentBook', () => {
  it('splits a book into the segments the engines will speak', async () => {
    const chapters = await segmentBook(
      book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength)
    )

    expect(chapters.length).toBeGreaterThan(0)
    expect(chapters[0].segments.length).toBeGreaterThan(0)
    expect(chapters[0].segments[0].text.trim().length).toBeGreaterThan(0)
  })

  it('cuts the book short when it is asked to', async () => {
    const all = await segmentBook(
      book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength)
    )
    const one = await segmentBook(
      book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength),
      undefined,
      1
    )

    expect(one.length).toBe(1)
    expect(one.length).toBeLessThanOrEqual(all.length)
  })
})
