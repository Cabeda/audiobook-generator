/**
 * Reader auto-playback E2E test.
 *
 * Opens an article in the text reader and, without touching anything, checks
 * that the reader plays the whole chapter: every segment, in order, from the
 * first to the last.
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so the
 * real playback chain runs (blob URL, <audio> element, `ended` event) without
 * downloading a model. The nightly engine tests cover the real engines.
 */

import { test, expect } from '@playwright/test'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'
import { installReaderProbe, openReader, readProbe } from '../helpers/readerProbe'

const EXAMPLE_ARTICLE = join(process.cwd(), 'example', 'esim_article.epub')

test.describe('Reader auto-playback', () => {
  test('plays every segment of the article in order, from beginning to end', async ({ page }) => {
    test.setTimeout(120_000)

    const errors: string[] = []
    const logs: string[] = []
    page.on('console', (message) => {
      logs.push(`[${message.type()}] ${message.text()}`)
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.addInitScript(installReaderProbe)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Start from a clean slate: no saved progress, no cached books.
    await page.evaluate(async () => {
      const databases = await indexedDB.databases()
      await Promise.all(
        databases.map((database) => {
          if (!database.name) return Promise.resolve()
          return new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(database.name as string)
            request.onsuccess = () => resolve()
            request.onerror = () => resolve()
            request.onblocked = () => resolve()
          })
        })
      )
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')

    const segmentCount = await openReader(page, EXAMPLE_ARTICLE, /eSIM/)
    expect(segmentCount).toBeGreaterThan(5)

    // Nothing else happens from here on: the reader has to do it by itself.
    const deadline = Date.now() + 60_000
    let state = await readProbe(page)
    while (
      Date.now() < deadline &&
      !(state.ended >= segmentCount && state.active.length >= segmentCount)
    ) {
      await page.waitForTimeout(250)
      state = await readProbe(page)
    }

    const expected = Array.from({ length: segmentCount }, (_, index) => index)
    const interesting = logs.filter(
      (line) =>
        !/Downloading onnx|KokoroCache|model_quantized|SegmentBatchHandler|saveChapterSegments|MobileDetect|\[vite\]/.test(
          line
        )
    )
    await writeFile('/tmp/reader-playback.log', logs.join('\n'))
    const report =
      `segments=${segmentCount} active=${state.active.length}/${segmentCount} ` +
      `played=${state.played} ended=${state.ended} errored=${state.errored} ` +
      `created=${state.created} requests=${state.requests} ` +
      `lastActive=${state.active[state.active.length - 1]} ` +
      `errors=${JSON.stringify(errors.slice(0, 5))}\n` +
      interesting.slice(0, 60).join('\n')

    // Every segment became active, exactly once, in order.
    expect(state.active, report).toEqual(expected)

    // Every segment's audio played to its natural end.
    expect(state.ended, report).toBeGreaterThanOrEqual(segmentCount)
  })
})
