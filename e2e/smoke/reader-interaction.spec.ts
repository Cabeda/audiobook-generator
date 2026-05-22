import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Reader Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should upload a book and see chapter list with controls', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Model select is visible in toolbar
    const modelSelect = page.locator('.toolbar-left .premium-select').first()
    await expect(modelSelect).toBeVisible()

    // Chapter selection controls exist
    await expect(page.getByRole('button', { name: 'Select All', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Deselect All', exact: true })).toBeVisible()
  })

  test('should open text reader from chapter', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Click Read button on first chapter
    const readButton = page.getByRole('button', { name: /Read chapter/ }).first()
    await readButton.click()

    // Reader page should open
    await expect(page.locator('.reader-page')).toBeVisible({ timeout: 5000 })

    // Back button should be available
    await expect(page.getByRole('button', { name: 'Back to book' })).toBeVisible()
  })
})
