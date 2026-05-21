/**
 * E2E test to reproduce MP3 export encoding error.
 * Uploads Sign of the Four, generates one chapter with Web Speech API,
 * then exports as MP3 to verify Mediabunny encoding works end-to-end.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SIGN_OF_FOUR_EPUB = join(
  process.cwd(),
  'books',
  'arthur-conan-doyle_the-sign-of-the-four_advanced.epub'
)

test.describe('MP3 Export Encoding', () => {
  test('should export generated chapter as MP3 without encoding error', async ({ page }) => {
    test.setTimeout(120000)

    // Capture console errors
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Upload Sign of the Four
    const epubBuffer = await readFile(SIGN_OF_FOUR_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'the-sign-of-the-four.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=/sign of the four/i', { timeout: 15000 })

    // Deselect all, then select only first chapter
    const deselectBtn = page.locator('button:has-text("Deselect all")')
    if (await deselectBtn.isVisible()) {
      await deselectBtn.click()
    }
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Use Web Speech API (fastest, no model download)
    const modelSelect = page.locator('select').filter({ hasText: /Web Speech|Kokoro|Piper/ })
    if (await modelSelect.isVisible()) {
      await modelSelect.selectOption({ label: 'Web Speech' })
    }

    // Open advanced options and select MP3 format
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    if (await advancedToggle.isVisible()) {
      await advancedToggle.click()
    }
    const formatSelect = page.locator('label:has-text("Format") select')
    if (await formatSelect.isVisible()) {
      await formatSelect.selectOption('mp3')
    }

    // Click generate
    const generateBtn = page.locator('button:has-text("Generate")')
    await generateBtn.click()

    // Wait for generation to complete (Web Speech is fast)
    await page.waitForSelector('text=/complete|done|generated/i', { timeout: 60000 })

    // Now export — click the download/export button
    const exportBtn = page.locator('button:has-text("Download"), button:has-text("Export")')
    if (await exportBtn.isVisible()) {
      await exportBtn.click()
    }

    // Wait a moment for export to process
    await page.waitForTimeout(5000)

    // Check that no ENCODING_ERROR appeared in console
    const encodingErrors = consoleErrors.filter((e) => e.includes('ENCODING_ERROR'))
    expect(encodingErrors).toHaveLength(0)

    // Should not show "Export failed" in the UI
    const exportFailed = page.locator('text=/Export failed/i')
    await expect(exportFailed).not.toBeVisible()
  })
})
