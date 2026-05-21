/**
 * E2E test to reproduce MP3 export encoding error.
 * Uses the short test EPUB, generates one chapter with Kokoro,
 * then exports as MP3 to verify Mediabunny encoding works.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

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

    // Upload short test EPUB
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Deselect all, then select only first chapter
    await page.locator('button:has-text("Deselect All")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Generate the first chapter (Kokoro is default)
    await page.locator('button:has-text("Generate Selected")').click()

    // Wait for generation to complete
    await page.waitForSelector('text=✓ Generated', { timeout: 90000 })

    // Clear console messages before export
    consoleMessages.length = 0

    // Click Export MP3
    const exportBtn = page.locator('button:has-text("Export MP3")')
    await expect(exportBtn).toBeVisible({ timeout: 5000 })
    await exportBtn.click()

    // Wait for export to process (check console for result)
    await page.waitForTimeout(10000)

    // Check results
    const hasEncodingError = consoleMessages.some((m) => m.includes('ENCODING_ERROR'))
    const hasExportFailed = consoleMessages.some((m) => m.includes('Export failed'))
    const hasSuccess = consoleMessages.some(
      (m) => m.includes('download-trigger') || m.includes('Audiobook created')
    )

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
    expect(hasSuccess).toBe(true)
  })
})
