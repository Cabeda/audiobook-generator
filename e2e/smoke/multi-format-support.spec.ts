import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

import { booksOverlay, importAndOpen, importPanel, openBooksOverlay } from '../helpers/flows'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_FILES_DIR = path.join(__dirname, '..', 'test-files')
const SAMPLE_TXT = path.join(TEST_FILES_DIR, 'sample.txt')
const SAMPLE_HTML = path.join(TEST_FILES_DIR, 'sample.html')

test.describe('Multi-Format Support', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
  })

  test('should display supported formats in upload area', async ({ page }) => {
    // The import panel's file picker lists every supported format
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

  test('should upload and parse TXT file', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    await expect(page.locator('.book-title')).toContainText('The Great Adventure')
    await openBooksOverlay(page)
    await expect(booksOverlay(page).locator('.card .meta').first()).toContainText('Test Author')

    // Format shown in the book details
    const card = booksOverlay(page).locator('.card', { hasText: 'The Great Adventure' })
    await card.locator('button[aria-label^="More actions"]').click()
    await card.locator('.menu button', { hasText: 'Details' }).click()
    await expect(page.locator('section[aria-label="Book details"]')).toContainText(/format txt/i)

    // Chapters detected
    await page.locator('section[aria-label="Book details"] button[aria-label="Close"]').click()
    await page.locator('button[aria-label="Table of contents"]').click()
    await expect(page.locator('.toc-item', { hasText: 'Chapter 1' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter 2' })).toBeVisible()
    await expect(page.locator('.toc-item', { hasText: 'Chapter 3' })).toBeVisible()
  })

  test('should upload and parse HTML file', async ({ page }) => {
    await importAndOpen(page, SAMPLE_HTML, /Sample HTML Book/)

    await expect(page.locator('.book-title')).toContainText('Sample HTML Book')
    await openBooksOverlay(page)
    await expect(booksOverlay(page).locator('.card .meta').first()).toContainText(
      'HTML Test Author'
    )

    // Format shown in the book details
    const htmlCard = booksOverlay(page).locator('.card', { hasText: 'Sample HTML Book' })
    await htmlCard.locator('button[aria-label^="More actions"]').click()
    await htmlCard.locator('.menu button', { hasText: 'Details' }).click()
    await expect(page.locator('section[aria-label="Book details"]')).toContainText(/format html/i)

    // Chapters from h1 tags
    await page.locator('section[aria-label="Book details"] button[aria-label="Close"]').click()
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

    // Should show error message in the import panel
    await expect(panel.locator('.err')).toBeVisible({ timeout: 5000 })
  })

  test('should show per-chapter settings for every chapter', async ({ page }) => {
    await importAndOpen(page, SAMPLE_TXT, /The Great Adventure/)

    // Chapter selection is gone; every chapter instead carries its own
    // language/model/voice settings in the book details.
    await openBooksOverlay(page)
    const advCard = booksOverlay(page).locator('.card', { hasText: 'The Great Adventure' })
    await advCard.locator('button[aria-label^="More actions"]').click()
    await advCard.locator('.menu button', { hasText: 'Details' }).click()
    const detail = page.locator('section[aria-label="Book details"]')
    await expect(detail.locator('.row')).toHaveCount(3)
    await expect(detail.locator('select[aria-label="Language for Chapter 1"]')).toBeVisible()
  })
})
