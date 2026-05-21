/**
 * E2E test: export MP3 for a multi-segment chapter.
 * Reproduces the "Failed to concatenate segments" error when segments have
 * mismatched WAV formats from Kokoro TTS.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('MP3 Export - Multi-segment chapter', () => {
  test('should export a multi-segment chapter as MP3 without concatenation error', async ({
    page,
  }) => {
    test.setTimeout(120000)

    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Upload EPUB
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Select all and generate
    await page.getByRole('button', { name: 'Select All', exact: true }).click()
    await page.locator('button:has-text("Generate Selected")').click()

    // Wait until at least the second chapter (6 segments) is generated
    await expect(page.locator('text=✓ Generated').nth(1)).toBeVisible({ timeout: 90000 })

    // Clear console before export
    consoleMessages.length = 0

    // Click the global Export MP3 button
    await page.locator('button:has-text("Export MP3")').click()

    // Wait for export to process
    await page.waitForTimeout(10000)

    // Check results
    const hasConcatError = consoleMessages.some((m) => m.includes('Failed to concatenate'))
    const hasEncodingError = consoleMessages.some((m) => m.includes('ENCODING_ERROR'))
    const hasExportFailed = consoleMessages.some((m) => m.includes('Export failed'))

    console.log(
      'Console messages after export:',
      consoleMessages.filter(
        (m) =>
          m.includes('ERROR') ||
          m.includes('WARN') ||
          m.includes('Export') ||
          m.includes('mediabunny') ||
          m.includes('concat')
      )
    )

    expect(hasConcatError).toBe(false)
    expect(hasEncodingError).toBe(false)
    expect(hasExportFailed).toBe(false)
  })
})
