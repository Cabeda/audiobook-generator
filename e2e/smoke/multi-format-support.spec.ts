import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, '..', 'test-files')
const SAMPLE_TXT = path.join(TEST_FILES_DIR, 'sample.txt')
const SAMPLE_HTML = path.join(TEST_FILES_DIR, 'sample.html')

test.describe('Multi-Format Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should display supported formats in upload area', async ({ page }) => {
    // The upload area shows supported formats in a <p class="secondary"> element
    await expect(page.getByText('Supported: EPUB, PDF, TXT, HTML')).toBeVisible()
  })

  test('should upload and parse TXT file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)

    // App auto-navigates to BookView after parsing
    await expect(page.getByText('The Great Adventure')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Test Author')).toBeVisible()

    // Format badge in hero header
    await expect(page.locator('.badge').filter({ hasText: 'TXT' })).toBeVisible()

    // Chapters detected
    await expect(page.getByText('Chapter 1')).toBeVisible()
    await expect(page.getByText('Chapter 2')).toBeVisible()
    await expect(page.getByText('Chapter 3')).toBeVisible()
  })

  test('should upload and parse HTML file', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_HTML)

    // App auto-navigates to BookView after parsing
    await expect(page.getByText('Sample HTML Book')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('HTML Test Author')).toBeVisible()

    // Format badge in hero header
    await expect(page.locator('.badge').filter({ hasText: 'HTML' })).toBeVisible()

    // Chapters from h1 tags
    await expect(page.getByText('Chapter One')).toBeVisible()
    await expect(page.getByText('Chapter Two')).toBeVisible()
    await expect(page.getByText('Chapter Three')).toBeVisible()
  })

  test('should show error for unsupported file format', async ({ page }) => {
    const unsupportedFile = path.join(TEST_FILES_DIR, 'test.xyz')
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(unsupportedFile)

    // Should show error message in the upload area
    await expect(page.locator('.error')).toBeVisible({ timeout: 5000 })
  })

  test('should allow selecting and deselecting chapters', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SAMPLE_TXT)
    await expect(page.getByText('The Great Adventure')).toBeVisible({ timeout: 10000 })

    // Deselect all first (auto-generation selects all)
    await page.getByRole('button', { name: 'Deselect All', exact: true }).click()

    // Verify all unchecked
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked()
    }

    // Select all
    await page.getByRole('button', { name: 'Select All', exact: true }).click()

    // Verify all checked
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked()
    }
  })
})
