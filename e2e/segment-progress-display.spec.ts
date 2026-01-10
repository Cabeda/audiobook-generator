import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Segment-triggered generation progress display', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies()
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should show progress indicator when generating chapter from book view', async ({
    page,
  }) => {
    test.setTimeout(180000)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.evaluate(async () => {
      const databases = await indexedDB.databases()
      await Promise.all(
        databases.map((db) => {
          if (db.name) {
            return new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name as string)
              req.onsuccess = () => resolve()
              req.onerror = () => resolve()
              req.onblocked = () => resolve()
            })
          }
          return Promise.resolve()
        })
      )
      localStorage.clear()
      sessionStorage.clear()
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    const epubBuffer = await readFile(SHORT_EPUB)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 30000 })
    await page.click('text=Short Test Book')
    await page.waitForSelector('h1:has-text("Short Test Book")', { timeout: 10000 })

    const generateButton = page.locator('button.generate-chapter-btn:visible').first()
    await expect(generateButton).toBeVisible({ timeout: 5000 })
    await generateButton.click()

    const segmentProgressText = page.locator('text=/\\d+ \\/ \\d+ segments/')
    const spinner = page.locator('.spinner, .spinner-container')

    await expect(segmentProgressText.first().or(spinner.first())).toBeVisible({
      timeout: 30000,
    })

    await page.screenshot({ path: 'test-results/generation-progress.png' })

    const hasSegmentProgress = await segmentProgressText
      .first()
      .isVisible()
      .catch(() => false)
    console.log(`[TEST] Has segment progress text: ${hasSegmentProgress}`)

    if (hasSegmentProgress) {
      const progressText = await segmentProgressText.first().textContent()
      console.log(`[TEST] Progress text: ${progressText}`)
      expect(progressText).toMatch(/\d+ \/ \d+ segments/)
    }
  })
})
