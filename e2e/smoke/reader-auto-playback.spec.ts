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
import { join } from 'path'
import process from 'node:process'
import {
  describePlayback,
  installFakeTtsWorker,
  installReaderProbe,
  openReader,
  waitForPlayback,
} from '../helpers/readerProbe'

const EXAMPLE_ARTICLE = join(process.cwd(), 'example', 'esim_article.epub')

test.describe('Reader auto-playback', () => {
  test('plays every segment of the article in order, from beginning to end', async ({ page }) => {
    test.setTimeout(120_000)

    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.addInitScript(installReaderProbe)
    await page.addInitScript(installFakeTtsWorker)

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
    const state = await waitForPlayback(page, segmentCount, 60_000)
    const report =
      describePlayback(state, segmentCount) + `\nerrors=${JSON.stringify(errors.slice(0, 5))}`

    // Every segment became active, exactly once, in order.
    expect(state.active, report).toEqual(Array.from({ length: segmentCount }, (_, i) => i))

    // Every segment's audio played to its natural end.
    expect(state.ended, report).toBeGreaterThanOrEqual(segmentCount)
  })
})
