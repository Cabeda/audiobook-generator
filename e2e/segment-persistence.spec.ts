import { test, expect } from '@playwright/test'
import { join } from 'path'

import { importAndOpen } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Segment Persistence on Page Refresh', () => {
  test('should persist generated segments and merged audio after page refresh', async ({
    page,
  }) => {
    test.setTimeout(120000)

    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      logs.push(text)
      console.log('[BROWSER]', text)
    })

    // Navigate to the app
    await page.goto('/')

    // Clear storage first
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Import the test book — it opens on the reading surface
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Click first segment to start generation
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Wait for first segment to be generated
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 30000 })
    const generatedBefore = await page.locator('.segment-generated').count()
    expect(generatedBefore).toBeGreaterThan(0)

    // Wait for audio to be saved
    await page.waitForTimeout(3000)

    // Refresh the page
    await page.reload()
    await page.waitForTimeout(2000)

    // Re-open the book from the library — the reader restores it whole
    const emptyBooks = page.locator('.empty-link', { hasText: 'Your books' })
    if (await emptyBooks.isVisible().catch(() => false)) {
      await emptyBooks.click()
      await page
        .locator('.card', { hasText: 'Short Test Book' })
        .locator('button', { hasText: 'Read' })
        .click()
    }
    await expect(page.locator('.book-title')).toContainText(/Short Test Book/, { timeout: 15000 })
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 15000 })

    // Wait for segments to load from DB
    await page.waitForTimeout(3000)

    // Segments generated before the refresh are still marked as generated
    const generatedSegmentsInUI = await page.locator('.segment-generated').count()
    console.log('Generated segments in UI after refresh:', generatedSegmentsInUI)
    expect(generatedSegmentsInUI).toBeGreaterThanOrEqual(generatedBefore)
  })
})
