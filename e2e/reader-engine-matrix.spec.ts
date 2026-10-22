/**
 * Reader engine matrix — nightly.
 *
 * Plays a short chapter with each real TTS engine. The chapter is short on
 * purpose: the model download dominates the run, and the point is to prove
 * that each engine can carry the reader from the first segment to the last.
 *
 * A model that cannot be downloaded is a network problem, not a broken
 * engine, so the test skips itself and says why.
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

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')
const ENGINES = ['kokoro', 'piper', 'pocket', 'kitten'] as const

/** How long a chapter may take once the model is there. */
const PLAYBACK_TIMEOUT_MS = 300_000

/** What a failed download looks like in the app's own log. */
const DOWNLOAD_FAILURE = /failed to (download|fetch|cache|load)|network ?error|ERR_/i

test.describe('Reader engine matrix', () => {
  for (const engine of ENGINES) {
    test(`plays the chapter from end to end with ${engine}`, async ({ page }) => {
      test.setTimeout(PLAYBACK_TIMEOUT_MS + 120_000)

      const logs: string[] = []
      page.on('console', (message) => logs.push(message.text()))
      page.on('pageerror', (error) => logs.push(String(error)))

      await page.addInitScript(installReaderProbe)

      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Pick the engine for the toolbar and for the reader, then start clean.
      await page.evaluate((model) => {
        localStorage.clear()
        sessionStorage.clear()
        localStorage.setItem('audiobook_model', model)
        localStorage.setItem('text_reader_model', model)
      }, engine)
      await page.reload()
      await page.waitForLoadState('networkidle')

      const segmentCount = await openReader(page, SHORT_EPUB, /Short Test Book/)
      expect(segmentCount).toBeGreaterThan(0)

      const state = await waitForPlayback(page, segmentCount, PLAYBACK_TIMEOUT_MS)
      const report = describePlayback(state, segmentCount)

      if (state.active.length < segmentCount) {
        const downloadFailure = logs.find((line) => DOWNLOAD_FAILURE.test(line))
        if (downloadFailure) {
          test.skip(true, `the ${engine} model could not be downloaded: ${downloadFailure}`)
        }
      }

      expect(state.active, report).toEqual(Array.from({ length: segmentCount }, (_, i) => i))
      expect(state.ended, report).toBeGreaterThanOrEqual(segmentCount)
    })
  }
})
