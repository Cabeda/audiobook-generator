/**
 * Reader full article — nightly.
 *
 * Plays the whole example article with a real engine, from the first segment
 * to the last. This is the run that proves the x/x claim on real audio: every
 * segment of a long chapter, in order, with nothing but the reader's own
 * machinery.
 *
 * Pocket is the engine used here because it is the smallest of the three, so
 * the run stays about a minute once the model is downloaded.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'
import {
  describePlayback,
  installReaderProbe,
  openReader,
  waitForPlayback,
} from './helpers/readerProbe'

const EXAMPLE_ARTICLE = join(process.cwd(), 'example', 'esim_article.epub')
const ENGINE = 'pocket'
const PLAYBACK_TIMEOUT_MS = 900_000

/** What a failed download looks like in the app's own log. */
const DOWNLOAD_FAILURE = /failed to (download|fetch|cache|load)|network ?error|ERR_/i

test.describe('Reader full article', () => {
  test('plays every segment of the article with a real engine', async ({ page }) => {
    test.setTimeout(PLAYBACK_TIMEOUT_MS + 120_000)

    const logs: string[] = []
    page.on('console', (message) => logs.push(message.text()))
    page.on('pageerror', (error) => logs.push(String(error)))

    await page.addInitScript(installReaderProbe)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.evaluate((model) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('audiobook_model', model)
      localStorage.setItem('text_reader_model', model)
    }, ENGINE)
    await page.reload()
    await page.waitForLoadState('networkidle')

    const segmentCount = await openReader(page, EXAMPLE_ARTICLE, /eSIM/)
    expect(segmentCount).toBeGreaterThan(20)

    const state = await waitForPlayback(page, segmentCount, PLAYBACK_TIMEOUT_MS)
    const report = describePlayback(state, segmentCount)

    if (state.active.length < segmentCount) {
      const downloadFailure = logs.find((line) => DOWNLOAD_FAILURE.test(line))
      if (downloadFailure) {
        test.skip(true, `the ${ENGINE} model could not be downloaded: ${downloadFailure}`)
      }
    }

    expect(state.active, report).toEqual(Array.from({ length: segmentCount }, (_, i) => i))
    expect(state.ended, report).toBeGreaterThanOrEqual(segmentCount)
  })
})
