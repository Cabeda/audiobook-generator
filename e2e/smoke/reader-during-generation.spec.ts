/**
 * Reader during book generation — E2E test.
 *
 * A book is uploaded and starts generating. While that is going on, the reader
 * is opened on a chapter further down the book. The reader is what the person
 * is listening to, so:
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

    // The book starts generating on its own.
    await page.locator('input[type="file"]').setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 30000,
    })
    await expect(page.getByRole('button', { name: 'Generating...', exact: true })).toBeVisible({
      timeout: 30000,
    })

    // No "generation was interrupted" banner while the generation is running.
    await expect(page.locator('.resume-banner')).toHaveCount(0)

    // Open the reader on the last chapter while the book is still generating.
    await page.getByRole('button', { name: /Read chapter: Chapter 3/ }).click()
    await expect(page.locator('.reader-page')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 15000 })

    const segmentCount = await page.locator('.segment').count()
    expect(segmentCount).toBeGreaterThan(0)

    // The reader plays by itself: nothing is clicked from here on.
    const state = await waitForPlayback(page, segmentCount, 90_000)
    expect(
      state.active.length,
      `active=${state.active.length}/${segmentCount} played=${state.played} ` +
        `ended=${state.ended} requests=${state.requests} errors=${JSON.stringify(logs.slice(0, 3))}`
    ).toBeGreaterThanOrEqual(segmentCount)

    // The rest of the book is still generated while the reader is on.
    await page.getByRole('button', { name: 'Back to book' }).click()
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 15000,
    })

    // The generation carries on and finishes the book.
    await expect(page.getByRole('button', { name: 'Generate Selected', exact: true })).toBeVisible({
      timeout: 120_000,
    })
    await expect(page.locator('.resume-banner')).toHaveCount(0)

    const chapters = new Set((await readProbe(page)).requestTexts.map(chapterOf))
    // Every chapter of the book was made, and none of them was interrupted.
    expect([...chapters].filter((chapter) => chapter > 0).sort()).toEqual([1, 2, 3])
  })
})
