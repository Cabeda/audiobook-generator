import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { importAndOpen, openSettingsPanel, settingsPanel } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Audiobook Generation - Smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    // The app opens straight into the reader's empty state
    await expect(page.locator('.empty-state h1')).toContainText(/Turn any book into an audiobook/i)
    // The read-along EPUB3 export is what the empty state sells
    await expect(page.locator('.empty-feature-tag')).toContainText(/EPUB3/i)
  })

  test('should switch reading theme before a book is open', async ({ page }) => {
    const sepia = page.locator('.empty-theme', { hasText: 'Sepia' })
    await sepia.click()
    await expect(sepia).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.empty-state')).toHaveCSS('background-color', 'rgb(244, 236, 216)')

    // the choice is the reader's theme, so it survives a reload
    await page.reload()
    await expect(page.locator('.empty-theme.on')).toContainText('Sepia')
  })

  test('should upload EPUB and display book info', async ({ page }) => {
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

    await expect(page.locator('.book-title')).toContainText('Short Test Book')

    // Verify chapter list is shown
    await page.locator('button[aria-label="Table of contents"]').click()
    const tocItems = page.locator('.toc-item')
    await expect(tocItems.first()).toBeVisible()
    expect(await tocItems.count()).toBeGreaterThanOrEqual(1)
  })

  test('should show model selector with options', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Model selector should be visible in the Aa settings panel with Kokoro as
    // default
    await openSettingsPanel(page)
    const modelSelect = settingsPanel(page).locator('label.field:has-text("Model") select')
    await expect(modelSelect).toBeVisible()
    await expect(modelSelect).toHaveValue('kokoro')

    // Should have multiple model options
    const options = modelSelect.locator('option')
    const optionCount = await options.count()
    expect(optionCount).toBeGreaterThanOrEqual(2)

    // Kokoro, Piper, Pocket and KittenTTS are offered
    const values = await options.evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value)
    )
    expect(values).toContain('kokoro')
    expect(values).toContain('piper')
    expect(values).toContain('pocket')
    expect(values).toContain('kitten')
  })
})
