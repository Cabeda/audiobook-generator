import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

import {
  booksOverlay,
  importAndOpen,
  importBookFile,
  importPanel,
  openBooksOverlay,
} from './helpers/flows'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, 'test-files')
const SAMPLE_TXT = path.join(TEST_FILES_DIR, 'sample.txt')
const SAMPLE_HTML = path.join(TEST_FILES_DIR, 'sample.html')

test.describe('Multi-Format eBook Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should display supported formats in upload area', async ({ page }) => {
    // The import panel offers every supported format in its file picker
    await page.locator('.empty-cta').click()
    const panel = importPanel(page)
    await expect(panel).toBeVisible()

    await expect(panel.locator('.drop')).toBeVisible()
    const accept = await panel.locator('input[type="file"]').getAttribute('accept')
    expect(accept).toContain('.epub')
    expect(accept).toContain('.pdf')
    expect(accept).toContain('.txt')
    expect(accept).toContain('.html')
  })

  test('should show format in book details after upload', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    // The book details carry the detected format, and it survives navigation
    await openBooksOverlay(page)
    await booksOverlay(page)
      .locator('.card', { hasText: 'The Great Adventure' })
      .locator('button', { hasText: 'Details' })
      .click()
    const detail = page.locator('section[aria-label="Book details"]')
    await expect(detail).toContainText(/format txt/i)

    // Close and re-open: the badge is still there
    await detail.locator('button[aria-label="Close"]').click()
    await openBooksOverlay(page)
    await booksOverlay(page)
      .locator('.card', { hasText: 'The Great Adventure' })
      .locator('button', { hasText: 'Details' })
      .click()
    await expect(page.locator('section[aria-label="Book details"]')).toContainText(/format txt/i)
  })

  test('should successfully upload and parse TXT file', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    // Verify title and author extracted (author lives in book details)
    await expect(page.locator('.book-title')).toContainText('The Great Adventure')
    await openBooksOverlay(page)
    await expect(booksOverlay(page).locator('.card .meta').first()).toContainText('Test Author')

    // Verify chapters detected — they are the sections of the scroll and the
    // rows of the table of contents
    await page.locator('section[aria-label="Books"] button[aria-label="Close"]').click()
    await page.locator('button[aria-label="Table of contents"]').click()
    const tocItems = page.locator('.toc-item')
    expect(await tocItems.count()).toBeGreaterThanOrEqual(3) // Should detect 3 chapters

    // Verify chapter titles
    await expect(page.locator('.toc-item', { hasText: 'Chapter 1' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter 2' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter 3' })).toBeVisible()
  })

  test('should successfully upload and parse HTML file', async ({ page }) => {
    await importAndOpen(page, SAMPLE_HTML, /Sample HTML Book/)

    // Verify title from HTML <title> tag
    await expect(page.locator('.book-title')).toContainText('Sample HTML Book')

    // Verify author from meta tag
    await openBooksOverlay(page)
    await expect(booksOverlay(page).locator('.card .meta').first()).toContainText(
      'HTML Test Author'
    )

    // Verify chapters from h1 tags
    await page.locator('section[aria-label="Books"] button[aria-label="Close"]').click()
    await page.locator('button[aria-label="Table of contents"]').click()
    await expect(page.locator('.toc-item', { hasText: 'Chapter One' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter Two' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter Three' })).toBeVisible()
  })

  test('should show error for unsupported file format', async ({ page }) => {
    await page.locator('.empty-cta').click()
    const panel = importPanel(page)
    await expect(panel).toBeVisible()

    const unsupportedFile = path.join(TEST_FILES_DIR, 'test.xyz')
    await panel.locator('.drop input[type="file"]').setInputFiles(unsupportedFile)

    // The panel reports the failure inline instead of an alert
    await expect(panel.locator('.err')).toBeVisible({ timeout: 5000 })
    await expect(panel.locator('.err')).toContainText(/Could not read/)
  })

  test('should offer per-chapter settings for every chapter', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    // Chapter selection for generation is gone; each chapter instead carries
    // its own language/model/voice settings in the book details.
    await openBooksOverlay(page)
    await booksOverlay(page)
      .locator('.card', { hasText: 'The Great Adventure' })
      .locator('button', { hasText: 'Details' })
      .click()
    const detail = page.locator('section[aria-label="Book details"]')
    await expect(detail.locator('.row')).toHaveCount(3)
    await expect(detail.locator('select[aria-label="Language for Chapter 1"]')).toBeVisible()
    await expect(detail.locator('select[aria-label="Model for Chapter 1"]')).toBeVisible()
    await expect(detail.locator('select[aria-label="Voice for Chapter 1"]')).toBeVisible()
  })

  test('should display chapter count correctly for TXT file', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    await openBooksOverlay(page)
    // The library card shows the chapter count
    await expect(booksOverlay(page).locator('.card .meta').nth(1)).toContainText('3 chapters')
  })

  test('should handle multiple file uploads sequentially', async ({ page }) => {
    // Upload TXT first
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    // Upload HTML second — it becomes the book on the reading surface
    await importBookFile(page, SAMPLE_HTML)
    await expect(page.locator('.book-title')).toContainText(/Sample HTML Book/, { timeout: 15000 })
    await expect(page.locator('.segment').first()).toBeVisible()

    // Both books are in the library now
    await openBooksOverlay(page)
    await expect(booksOverlay(page).locator('.card')).toHaveCount(2)
    await expect(
      booksOverlay(page).locator('.card h3', { hasText: 'The Great Adventure' })
    ).toBeVisible()
    await expect(
      booksOverlay(page).locator('.card h3', { hasText: 'Sample HTML Book' })
    ).toBeVisible()
  })
})
