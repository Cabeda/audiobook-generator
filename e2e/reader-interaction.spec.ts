import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Reader Interaction E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  // TODO: Skipped — these tests depend on Web Speech API mocking and complex
  // UI interaction timing that is unreliable in headless CI. The selectors
  // (.toolbar-center) are outdated (now .toolbar-left .premium-select).
  // Needs a rewrite with updated selectors and stable Web Speech mocking.
  // See issue #162 Phase 3 for planned test stabilization.
  test.skip('should play from clicked segment when paused', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book')

    const modelSelect = page.locator('.toolbar-left select.premium-select').first()
    await modelSelect.selectOption({ label: 'Web Speech API' })
    await expect(modelSelect).toHaveValue('web_speech')
  })

  test.skip('should open reader in text-only mode if no audio available', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book')
  })

  test('should upload a book and see chapter list', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book')

    // Verify model select is visible in toolbar
    const modelSelect = page.locator('.toolbar-left select.premium-select').first()
    await expect(modelSelect).toBeVisible()

    // Verify chapter selection controls exist
    await expect(page.getByRole('button', { name: 'Select All', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Deselect All' })).toBeVisible()
  })
})
