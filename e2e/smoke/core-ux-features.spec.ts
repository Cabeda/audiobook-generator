import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Core UX Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Upload test book
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await expect(page.getByRole('heading', { name: 'Short Test Book' })).toBeVisible({
      timeout: 10000,
    })

    // Open text reader
    await page.getByRole('button', { name: 'Deselect All', exact: true }).click()
    await page.locator('input[type="checkbox"]').first().check()
    const readButton = page.getByRole('button', { name: /Read chapter/ }).first()
    await readButton.click()
    await expect(page.locator('.reader-page')).toBeVisible({ timeout: 10000 })
  })

  test('should show keyboard help overlay', async ({ page }) => {
    // Press ? to show help
    await page.keyboard.press('?')

    // Verify overlay is visible with shortcuts
    await expect(page.locator('.keyboard-help-overlay')).toBeVisible()
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible()
    await expect(page.getByText('Play / Pause')).toBeVisible()
    await expect(page.getByText('Previous / Next segment')).toBeVisible()

    // Close by pressing ? again
    await page.keyboard.press('?')
    await expect(page.locator('.keyboard-help-overlay')).not.toBeVisible()
  })

  test('should close keyboard help with close button', async ({ page }) => {
    await page.keyboard.press('?')
    await expect(page.locator('.keyboard-help-overlay')).toBeVisible()

    // Close via button
    await page.locator('.keyboard-help-overlay .close-btn').click()
    await expect(page.locator('.keyboard-help-overlay')).not.toBeVisible()
  })

  test('should toggle settings panel', async ({ page }) => {
    // Open settings via aria-label button
    await page.getByRole('button', { name: 'Settings' }).click()

    // Model select should be visible in settings
    await expect(page.locator('#model-select')).toBeVisible()

    // Auto-scroll checkbox should be visible
    await expect(page.getByText('Auto-scroll during playback')).toBeVisible()
  })

  test('should toggle auto-scroll in settings', async ({ page }) => {
    // Open settings
    await page.getByRole('button', { name: 'Settings' }).click()

    // Find auto-scroll checkbox
    const autoScrollCheckbox = page
      .locator('label')
      .filter({ hasText: 'Auto-scroll' })
      .locator('input[type="checkbox"]')

    // Should be checked by default
    await expect(autoScrollCheckbox).toBeChecked()

    // Uncheck it
    await autoScrollCheckbox.click()
    await expect(autoScrollCheckbox).not.toBeChecked()

    // Check it again
    await autoScrollCheckbox.click()
    await expect(autoScrollCheckbox).toBeChecked()
  })

  test('should have toast container in DOM', async ({ page }) => {
    await expect(page.locator('.toast-container').first()).toBeAttached()
  })
})
