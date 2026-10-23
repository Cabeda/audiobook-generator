import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { installFakeTtsWorker, installReaderProbe } from './helpers/readerProbe'
import { importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Reader Interaction E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installReaderProbe)
    await page.addInitScript(installFakeTtsWorker)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('should play from clicked segment when paused', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    const third = page.locator('[data-section="0"] .segment').nth(2)
    await third.click()

    // Clicking a sentence continues from there
    await expect(third).toHaveClass(/active/, { timeout: 10000 })
    await expect(page.locator('.transport')).toBeVisible({ timeout: 10000 })
  })

  test('should open reader in text-only mode if no audio available', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // The text is fully readable before any audio exists: every sentence is
    // rendered, dimmed as pending, and no player is up.
    await expect(page.locator('.segment-pending').first()).toBeVisible()
    await expect(page.locator('.transport')).toBeHidden()
    await expect(page.locator('.prep')).toBeHidden()
  })

  test('should upload a book and see chapter list', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Chapter list lives in the table of contents
    await page.locator('button[aria-label="Table of contents"]').click()
    const tocItems = page.locator('.toc-item')
    await expect(tocItems.first()).toBeVisible()
    expect(await tocItems.count()).toBeGreaterThanOrEqual(3)

    // The model picker is in the Aa settings panel
    await page.locator('button[aria-label="Close"]:visible').first().click()
    await openSettingsPanel(page)
    await expect(settingsPanel(page).locator('label.field:has-text("Model") select')).toBeVisible()
  })
})
