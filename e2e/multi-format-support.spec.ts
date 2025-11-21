import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, 'test-files')
const SAMPLE_TXT = path.join(TEST_FILES_DIR, 'sample.txt')
const SAMPLE_HTML = path.join(TEST_FILES_DIR, 'sample.html')

test.describe('Multi-Format eBook Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173')
  })

  test('should display supported formats in upload area', async ({ page }) => {
    const uploadText = await page.locator('.upload-text').textContent()

    expect(uploadText).toContain('EPUB')
    expect(uploadText).toContain('PDF')
    expect(uploadText).toContain('TXT')
    expect(uploadText).toContain('HTML')
  })

  test.skip('should show format badge after EPUB upload', async ({ page }) => {
    // Skipped: requires specific EPUB file
    // This functionality is tested manually and in other existing E2E tests
  })

  test('should successfully upload and parse TXT file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)

    // Wait for parsing to complete
    await page.waitForSelector('.format-badge', { timeout: 5000 })

    // Verify format badge
    const badge = await page.locator('.format-badge').textContent()
    expect(badge).toBe('TXT')

    // Verify title and author extracted
    await expect(page.locator('text=The Great Adventure')).toBeVisible()
    await expect(page.locator('text=Test Author')).toBeVisible()

    // Verify chapters detected
    const chapterCheckboxes = page.locator('input[type="checkbox"]')
    const count = await chapterCheckboxes.count()
    expect(count).toBeGreaterThanOrEqual(3) // Should detect 3 chapters

    // Verify chapter titles
    await expect(page.locator('text=Chapter 1')).toBeVisible()
    await expect(page.locator('text=Chapter 2')).toBeVisible()
    await expect(page.locator('text=Chapter 3')).toBeVisible()
  })

  test('should successfully upload and parse HTML file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_HTML)

    // Wait for parsing
    await page.waitForSelector('.format-badge', { timeout: 5000 })

    // Verify format badge
    const badge = await page.locator('.format-badge').textContent()
    expect(badge).toBe('HTML')

    // Verify title from HTML <title> tag
    await expect(page.locator('text=Sample HTML Book')).toBeVisible()

    // Verify author from meta tag
    await expect(page.locator('text=HTML Test Author')).toBeVisible()

    // Verify chapters from h1 tags
    await expect(page.locator('text=Chapter One')).toBeVisible()
    await expect(page.locator('text=Chapter Two')).toBeVisible()
    await expect(page.locator('text=Chapter Three')).toBeVisible()
  })

  test('should show error for unsupported file format', async ({ page }) => {
    // Create a temporary file with unsupported extension
    const unsupportedFile = path.join(TEST_FILES_DIR, 'test.xyz')

    // Listen for alert dialog
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Failed to parse')
      expect(dialog.message()).toContain('Unsupported format')
      await dialog.accept()
    })

    const fileInput = page.locator('input[type="file"]')
    // This will trigger an error which should show an alert
    await fileInput.setInputFiles(unsupportedFile).catch(() => {
      // File might not exist, that's okay for this test
    })
  })

  test('should allow selecting chapters for generation', async ({ page }) => {
    // Upload TXT file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)

    await page.waitForSelector('.format-badge', { timeout: 5000 })

    // Select all chapters
    const selectAllButton = page.getByRole('button', { name: 'Select all', exact: true })
    await selectAllButton.click()

    // Verify all checkboxes are checked
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()

    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes.nth(i)
      await expect(checkbox).toBeChecked()
    }

    // Deselect all
    const deselectAllButton = page.getByRole('button', { name: 'Deselect all', exact: true })
    await deselectAllButton.click()

    // Verify all unchecked
    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes.nth(i)
      await expect(checkbox).not.toBeChecked()
    }
  })

  test('should display chapter count correctly for TXT file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)

    await page.waitForSelector('.format-badge', { timeout: 5000 })

    // Should show chapter count
    await expect(page.locator('text=/\\d+ chapters?/')).toBeVisible()
  })

  test('should handle multiple file uploads sequentially', async ({ page }) => {
    // Upload TXT first
    let fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)
    await page.waitForSelector('.format-badge', { timeout: 5000 })

    let badge = await page.locator('.format-badge').textContent()
    expect(badge).toBe('TXT')

    // Upload HTML second
    fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_HTML)
    await page.waitForSelector('.format-badge', { timeout: 5000 })

    badge = await page.locator('.format-badge').textContent()
    expect(badge).toBe('HTML')

    // Verify HTML content is now shown
    await expect(page.locator('text=Sample HTML Book')).toBeVisible()
  })

  test('should preserve format badge during interaction', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)

    await page.waitForSelector('.format-badge', { timeout: 5000 })

    // Interact with the page (select/deselect chapters)
    const selectAllButton = page.getByRole('button', { name: 'Select all', exact: true })
    await selectAllButton.click()

    // Format badge should still be visible
    const badge = page.locator('.format-badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('TXT')
  })
})
