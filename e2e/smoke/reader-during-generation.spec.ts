/**
 * Reader during book generation — E2E test.
 *
 * A book is imported and the whole book starts generating. While that is going
 * on, the reader is opened on a chapter further down the book. The reader is
 * what the person is listening to, so:
 *
 * - it starts playing by itself, without asking anything;
 * - the book carries on afterwards;
 * - no "generation was interrupted" banner appears while it is running.
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so no
 * model is downloaded and every generation takes a known amount of time.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'
import {
  installFakeTtsWorker,
  installReaderProbe,
  readProbe,
  waitForPlayback,
} from '../helpers/readerProbe'
import { clearAppStorage, importAndOpen, openSettingsPanel, settingsPanel } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/** How long a generated segment takes, so the generation is still running. */
const SEGMENT_DELAY_MS = 400

/** A phrase that tells which chapter a generated segment belongs to. */
const CHAPTER_PHRASES = [
  'very short first chapter',
  'second chapter describes',
  'short final chapter',
]

function chapterOf(text: string): number {
  const index = CHAPTER_PHRASES.findIndex((phrase) => text.includes(phrase))
  return index === -1 ? -1 : index + 1
}

test.describe('Reader during book generation', () => {
  test('plays the chapter the reader is on, and the book carries on', async ({ page }) => {
    test.setTimeout(180_000)

    const logs: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') logs.push(message.text())
    })

    await page.addInitScript(installReaderProbe)
    await page.addInitScript(installFakeTtsWorker, { delayMs: SEGMENT_DELAY_MS })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // The book is imported and the whole book starts generating.
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
    await openSettingsPanel(page)
    await settingsPanel(page).locator('button.action', { hasText: 'Generate audiobook' }).click()
    await page.locator('aside.settings button[aria-label="Close"]').click()
    await expect(page.locator('.prep')).toBeVisible({ timeout: 30000 })

    // No interruption surface while the generation is running.
    await expect(page.locator('.resume-banner')).toHaveCount(0)
    await expect(page.locator('.error-strip')).toHaveCount(0)

    // Open the reader on the last chapter while the book is still generating.
    await page.locator('button[aria-label="Table of contents"]').click()
    await page.locator('.toc-item').nth(2).click()
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    const segmentCount = await page.locator('[data-section="2"] .segment').count()
    expect(segmentCount).toBeGreaterThan(0)

    // The reader plays by itself: nothing is clicked from here on.
    const state = await waitForPlayback(page, segmentCount, 90_000)
    expect(
      state.active.length,
      `active=${state.active.length}/${segmentCount} played=${state.played} ` +
        `ended=${state.ended} requests=${state.requests} errors=${JSON.stringify(logs.slice(0, 3))}`
    ).toBeGreaterThanOrEqual(segmentCount)

    // The generation carries on and finishes the book: every chapter of the
    // book is made, and none of them was interrupted.
    await expect(page.locator('.resume-banner')).toHaveCount(0)
    await expect(page.locator('.error-strip')).toHaveCount(0)

    await expect
      .poll(
        async () =>
          [...new Set((await readProbe(page)).requestTexts.map(chapterOf))]
            .filter((chapter) => chapter > 0)
            .sort(),
        { timeout: 120_000 }
      )
      .toEqual([1, 2, 3])
  })
})
