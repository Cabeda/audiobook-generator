import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/**
 * Generation & Export smoke test.
 *
 * Uses Piper TTS (small model, fast generation) to generate a single
 * short chapter, then exports as each format to verify the full pipeline.
 * First run downloads the voice model (~5MB), subsequent runs use cache.
 */
test.describe('Generation & Export', () => {
  test.describe.configure({ timeout: 120000 })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Upload EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Switch to Piper TTS (smaller model, faster than Kokoro)
    const modelSelect = page.locator('.toolbar-left .premium-select').first()
    await modelSelect.selectOption('piper')

    // Select only first chapter
    await page.getByRole('button', { name: 'Deselect All', exact: true }).click()
    await page.locator('input[type="checkbox"]').first().check()
  })

  test('should generate a chapter and export as MP3', async ({ page }) => {
    // Generate
    await page.getByRole('button', { name: 'Generate Selected' }).click()

    // Wait for generation to complete
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    // Export MP3 (default format)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export MP3/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mp3$/i)
  })

  test('should export as WAV', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    // Switch format to WAV
    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'WAV' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export WAV/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.wav$/i)
  })

  test('should export as M4B', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    // Switch format to M4B
    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'M4B Audiobook' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export M4B/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.m4b$/i)
  })

  test('should export as EPUB with media overlays', async ({ page }) => {
    await page.getByRole('button', { name: 'Generate Selected' }).click()
    await expect(page.getByText('✓ Generated')).toBeVisible({ timeout: 90000 })

    // Switch format to EPUB
    await page.getByRole('button', { name: 'Choose export format' }).click()
    await page.getByRole('menuitem', { name: 'EPUB' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /Export EPUB/i }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.epub$/i)
  })
})
