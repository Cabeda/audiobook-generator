import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import {
  clearAppStorage,
  importAndOpen,
  openQueueCenter,
  queueCenter,
  generateAudiobook,
} from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Segment-triggered generation progress display', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies()
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should show progress indicator when generating the book', async ({ page }) => {
    test.setTimeout(180000)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('networkidle')

    const epubBuffer = await readFile(SHORT_EPUB)
    await importAndOpen(
      page,
      {
        name: 'test-short.epub',
        mimeType: 'application/epub+zip',
        buffer: epubBuffer,
      },
      /Short Test Book/
    )

    // Generate from the Aa settings panel (the old per-chapter generate
    // buttons lived on the book view, which is gone)
    await generateAudiobook(page)

    // The progress strip reports percentage progress while segments are made
    const prep = page.locator('.prep')
    await expect(prep).toBeVisible({ timeout: 30000 })
    await expect(prep).toContainText(/Preparing audio… \d+%/)

    // The activity centre shows the same progress per chapter
    await openQueueCenter(page)
    await expect(queueCenter(page)).toContainText(/ready|generating|not generated/)
    await expect(queueCenter(page).locator('.pill').first()).toBeVisible()

    await page.screenshot({ path: 'test-results/generation-progress.png' })
  })
})
