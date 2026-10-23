/**
 * E2E test to reproduce MP3 export encoding error.
 * Uses the short test EPUB, generates one chapter with Kokoro,
 * then exports as MP3 to verify Mediabunny encoding works.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { exportAs, exportSheet, importAndOpen } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('MP3 Export Encoding', () => {
  test('should export generated chapter as MP3 without encoding error', async ({ page }) => {
    test.setTimeout(120000)

    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Import the short test EPUB — it opens on the reading surface
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

    // Generate the first chapter (Kokoro is default) by listening to it
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 90000,
      })
      .toBe(await page.locator('[data-section="0"] .segment').count())

    // Clear console messages before export
    consoleMessages.length = 0

    // Export as MP3 through the export sheet
    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()

    // The sheet reports success
    await expect(exportSheet(page).locator('.done')).toContainText(/✓ Exported/)

    // Check results
    const hasEncodingError = consoleMessages.some((m) => m.includes('ENCODING_ERROR'))
    const hasExportFailed = consoleMessages.some((m) => m.includes('Export failed'))

    // Log all messages for debugging
    console.log(
      'Console messages after export:',
      consoleMessages.filter(
        (m) =>
          m.includes('ERROR') ||
          m.includes('Export') ||
          m.includes('mediabunny') ||
          m.includes('download')
      )
    )

    expect(hasEncodingError).toBe(false)
    expect(hasExportFailed).toBe(false)
  })
})
