import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Audiobook Generation - Smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    await expect(page.locator('h1')).toContainText(/Audiobook Generator/i)
  })

  test('should upload EPUB and display book info', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByText('Test Author')).toBeVisible()

    // Verify chapter list is shown
    const checkboxes = page.locator('input[type="checkbox"]')
    await expect(checkboxes.first()).toBeVisible()
    const count = await checkboxes.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('should show model selector with options', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Model selector should be visible with Kokoro as default
    const modelSelect = page.locator('.toolbar-left .premium-select').first()
    await expect(modelSelect).toBeVisible()
    await expect(modelSelect).toHaveValue('kokoro')

    // Should have multiple model options
    const options = modelSelect.locator('option')
    const optionCount = await options.count()
    expect(optionCount).toBeGreaterThanOrEqual(2)
  })
})
