/**
 * Core UX Features E2E Tests
 *
 * Tests for new features:
 * - Skip controls (10s forward/backward)
 * - Keyboard shortcuts
 * - Auto-scroll during playback
 * - Progress persistence
 * - Keyboard help overlay
 * - Error handling with toasts
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Core UX Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Clear storage
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    // Mock Web Speech API
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => {
          utterance.onstart?.({} as SpeechSynthesisEvent)
          setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 100)
        }, 10)
      }
      window.speechSynthesis.cancel = () => {}
      window.speechSynthesis.getVoices = () => [
        { name: 'Test Voice', lang: 'en-US', default: true } as SpeechSynthesisVoice,
      ]
    })

    // Upload test book
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Open text reader by clicking Read button
    await page.locator('button:has-text("Deselect all")').click()
    await page.waitForTimeout(200)
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    await page.waitForTimeout(200)
    const readButton = page.locator('button:has-text("Read")').first()
    await expect(readButton).toBeEnabled({ timeout: 15000 })
    await readButton.click()
    await page.waitForSelector('.reader-page', { timeout: 10000 })

    // Switch to Web Speech in reader
    const settingsBtn = page.locator('.reader-page button').filter({ hasText: /⚙/ })
    await settingsBtn.click()
    await page.waitForTimeout(200)

    const modelSelect = page.locator('select').filter({ hasText: /Web Speech/ })
    await modelSelect.selectOption('web_speech')
    await page.waitForTimeout(200)

    // Close settings
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })

  test('should skip 10 seconds forward and backward', async ({ page }) => {
    // Click first segment to start
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()
    await page.waitForTimeout(300)

    // Find skip buttons
    const skipButtons = page.locator('button.skip-10')
    await expect(skipButtons.first()).toBeVisible()

    // Get initial segment index
    const initialIndex = await page.evaluate(() => {
      return (window as any).audioService?.currentSegmentIndex ?? -1
    })

    expect(initialIndex).toBeGreaterThanOrEqual(0)

    // Test skip forward (last skip button)
    await skipButtons.last().click()
    await page.waitForTimeout(300)

    const afterForwardIndex = await page.evaluate(() => {
      return (window as any).audioService?.currentSegmentIndex ?? -1
    })

    expect(afterForwardIndex).toBeGreaterThan(initialIndex)

    // Test skip backward (first skip button)
    await skipButtons.first().click()
    await page.waitForTimeout(300)

    const afterBackIndex = await page.evaluate(() => {
      return (window as any).audioService?.currentSegmentIndex ?? -1
    })

    expect(afterBackIndex).toBeLessThanOrEqual(afterForwardIndex)
  })

  test('should respond to keyboard shortcuts', async ({ page }) => {
    // Click segment to start
    await page.locator('.segment').first().click()
    await page.waitForTimeout(300)

    // Test Space (play/pause)
    await page.keyboard.press('Space')
    await page.waitForTimeout(200)

    const isPaused = await page.evaluate(() => {
      return !(window as any).audioService?.isPlaying
    })
    expect(isPaused).toBe(true)

    // Test ? (keyboard help)
    await page.keyboard.press('?')
    await page.waitForTimeout(200)

    await expect(page.locator('.keyboard-help-overlay')).toBeVisible()

    // Close help
    await page.keyboard.press('?')
    await page.waitForTimeout(200)

    await expect(page.locator('.keyboard-help-overlay')).not.toBeVisible()
  })

  test('should show keyboard help overlay', async ({ page }) => {
    // Press ? to show help
    await page.keyboard.press('?')
    await page.waitForTimeout(100)

    // Verify overlay is visible
    await expect(page.locator('.keyboard-help-overlay')).toBeVisible()
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible()

    // Verify shortcuts are listed
    await expect(page.locator('text=Play / Pause')).toBeVisible()
    await expect(page.locator('text=Previous / Next segment')).toBeVisible()
    await expect(page.locator('text=Skip 10s back / forward')).toBeVisible()

    // Close by clicking close button
    await page.click('.close-btn')
    await page.waitForTimeout(100)

    await expect(page.locator('.keyboard-help-overlay')).not.toBeVisible()
  })

  test('should auto-scroll to current segment during playback', async ({ page }) => {
    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0))

    // Click a segment near the middle
    const segments = page.locator('.segment')
    const segmentCount = await segments.count()
    const targetSegment = segments.nth(Math.min(segmentCount - 1, 5))

    await targetSegment.click()
    await page.waitForTimeout(500)

    // Check if the active segment is in viewport
    const isInViewport = await page.evaluate(() => {
      const activeSegment = document.querySelector('.segment.active')
      if (!activeSegment) return false

      const rect = activeSegment.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight
    })

    // Auto-scroll should keep it visible
    expect(isInViewport).toBe(true)
  })

  test('should toggle auto-scroll in settings', async ({ page }) => {
    // Open settings
    const settingsBtn = page.locator('button').filter({ hasText: /settings|⚙/i })
    await settingsBtn.click()
    await page.waitForTimeout(200)

    // Find auto-scroll checkbox
    const autoScrollLabel = page.locator('label:has-text("Auto-scroll")')
    await expect(autoScrollLabel).toBeVisible()

    const autoScrollCheckbox = autoScrollLabel.locator('input[type="checkbox"]')

    // Should be checked by default
    await expect(autoScrollCheckbox).toBeChecked()

    // Uncheck it
    await autoScrollCheckbox.click()
    await page.waitForTimeout(100)

    await expect(autoScrollCheckbox).not.toBeChecked()

    // Check it again
    await autoScrollCheckbox.click()
    await page.waitForTimeout(100)

    await expect(autoScrollCheckbox).toBeChecked()
  })

  test('should persist progress across page reloads', async ({ page }) => {
    // Click segment to start playback
    const segments = page.locator('.segment')
    await segments.nth(3).click()
    await page.waitForTimeout(500)

    // Get current segment index
    const segmentIndex = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).audioService?.currentSegmentIndex ?? -1
    })

    expect(segmentIndex).toBeGreaterThanOrEqual(3)

    // Reload page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Re-upload book
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Select Web Speech again
    const modelSelect = page.locator('.toolbar-center select').first()
    await modelSelect.selectOption({ label: 'Web Speech API' })

    // Open same chapter
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    const readButton = page.locator('button:has-text("Read")').first()
    await readButton.click()
    await page.waitForSelector('.reader-page', { timeout: 5000 })

    // Should show resume prompt
    await expect(page.locator('.resume-prompt')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('text=/resume/i')).toBeVisible()

    // Click Resume button
    await page.click('button:has-text("Resume")')
    await page.waitForTimeout(300)

    // Should resume from saved position
    const resumedIndex = await page.evaluate(() => {
      return (window as any).audioService?.currentSegmentIndex ?? -1
    })

    expect(resumedIndex).toBeGreaterThanOrEqual(segmentIndex - 2)
  })

  test('should show resume prompt with start over option', async ({ page }) => {
    // Play from middle
    await page.locator('.segment').nth(3).click()
    await page.waitForTimeout(500)

    // Reload
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Re-upload and open
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    const modelSelect = page.locator('.toolbar-center select').first()
    await modelSelect.selectOption({ label: 'Web Speech API' })

    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    const readButton = page.locator('button:has-text("Read")').first()
    await readButton.click()
    await page.waitForSelector('.reader-page', { timeout: 5000 })

    // Should show resume prompt
    await expect(page.locator('.resume-prompt')).toBeVisible({ timeout: 3000 })

    // Click Start Over
    await page.click('button:has-text("Start Over")')
    await page.waitForTimeout(200)

    // Prompt should disappear
    await expect(page.locator('.resume-prompt')).not.toBeVisible()
  })

  test('should display toast container', async ({ page }) => {
    // Verify the toast container exists in the DOM
    const toastContainer = page.locator('.toast-container')
    await expect(toastContainer).toBeAttached()
  })

  test('should handle speed changes with arrow keys', async ({ page }) => {
    // Start playback
    await page.locator('.segment').first().click()
    await page.waitForTimeout(300)

    // Get initial speed
    const initialSpeed = await page.evaluate(() => {
      return (window as any).audioService?.playbackSpeed ?? 1.0
    })

    // Press ArrowUp to increase speed
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(200)

    const increasedSpeed = await page.evaluate(() => {
      return (window as any).audioService?.playbackSpeed ?? 1.0
    })

    expect(increasedSpeed).toBeGreaterThan(initialSpeed)

    // Press ArrowDown to decrease speed
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(200)

    const decreasedSpeed = await page.evaluate(() => {
      return (window as any).audioService?.playbackSpeed ?? 1.0
    })

    expect(decreasedSpeed).toBeLessThan(increasedSpeed)
  })
})
