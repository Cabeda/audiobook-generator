import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { importAndOpen, importPanel, openSettingsPanel, settingsPanel } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Reader Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
  })

  test('should upload a book and see chapter list with controls', async ({ page }) => {
    // Chapter list lives in the table of contents
    await page.locator('button[aria-label="Table of contents"]').click()
    const tocItems = page.locator('.toc-item')
    await expect(tocItems.first()).toBeVisible()

    // Model select is visible in the Aa settings panel
    await page.locator('.toc-backdrop').click()
    await openSettingsPanel(page)
    await expect(settingsPanel(page).locator('label.field:has-text("Model") select')).toBeVisible()

    // The library is reachable from the title button
    await page.locator('aside.settings button[aria-label="Close"]').click()
    await expect(page.locator('button[aria-label="Books"]')).toBeVisible()
  })

  test('should open text reader from chapter', async ({ page }) => {
    // The chapter titles of the reading surface, in order
    const titles = await page.locator('.chapter-mark').allInnerTexts()
    expect(titles.length).toBeGreaterThanOrEqual(2)

    // Jump to the second chapter from the table of contents
    await page.locator('button[aria-label="Table of contents"]').click()
    await page.locator('.toc-item').nth(1).click()

    // The reading surface scrolls to the chapter and the top bar follows it
    await expect(page.locator('.toc')).toBeHidden()
    // chapter headings render uppercase; the top bar shows them as written
    await expect(page.locator('.chapter-title')).toContainText(titles[1], { ignoreCase: true })

    // The title button is the way back to the library
    await expect(page.locator('button[aria-label="Books"]')).toBeVisible()
  })

  test('keeps the drawer working when two books share a title', async ({ page }) => {
    // Importing the same file twice is two library books with one title. The
    // drawer must key its rows by book id: keying by title threw Svelte's
    // each_key_duplicate and left the drawer blank.
    await page.locator('button[aria-label="Table of contents"]').click()
    await page.locator('.import-chip').click()
    await importPanel(page).locator('.drop input[type="file"]').setInputFiles(SHORT_EPUB)
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 15000 })

    // both books, plus "All books" and "Import"
    await expect(page.locator('.toc-books .toc-book')).toHaveCount(4)
    await expect(page.locator('.toc-books .toc-book', { hasText: 'Short Test Book' })).toHaveCount(
      2
    )
  })
})
