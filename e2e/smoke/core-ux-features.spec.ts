import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { importAndOpen, openSettingsPanel, settingsPanel } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Core UX Features', () => {
  test.beforeEach(async ({ page }) => {
    // Boot on Piper (small, fast, real audio): these tests are about the
    // reader's behaviour, not about one engine holding playback.
    await page.addInitScript(() => {
      localStorage.setItem('audiobook_model', '"piper"')
    })
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Import the test book — it opens on the reading surface
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
  })

  test('should toggle playback from the transport bar', async ({ page }) => {
    // Start listening, then pause and resume from the transport
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    const playPause = page.locator('.transport button[aria-label="Play or pause"]')
    // The first listen generates the chapter before it can play; give real
    // TTS the time it needs on slower runners.
    await expect(playPause).toContainText('❚❚', { timeout: 60000 })

    await playPause.click()
    await expect(playPause).toContainText('▶')

    await playPause.click()
    await expect(playPause).toContainText('❚❚')
  })

  test('should open settings panel with playback controls', async ({ page }) => {
    // Open settings via aria-label button
    await openSettingsPanel(page)

    // Model select should be visible in settings
    await expect(settingsPanel(page).locator('label.field:has-text("Model") select')).toBeVisible()

    // Playback speed should be adjustable there
    await expect(settingsPanel(page).locator('label.field:has-text("Speed") select')).toBeVisible()
  })

  test('should change text size from settings', async ({ page }) => {
    const column = page.locator('.column')
    const initialSize = await column.evaluate((el) => getComputedStyle(el).fontSize)

    // The A+ control steps the reading size up
    await page.locator('button[aria-label="Larger text"]').click()

    await expect
      .poll(() => column.evaluate((el) => getComputedStyle(el).fontSize))
      .not.toBe(initialSize)
  })

  test('should have toast container in DOM', async ({ page }) => {
    await expect(page.locator('.toast-container').first()).toBeAttached()
  })
})
