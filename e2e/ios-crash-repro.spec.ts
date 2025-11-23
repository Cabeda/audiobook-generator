import { test, expect } from '@playwright/test'
import path from 'path'

test.describe('iOS WebKit Crash Reproduction', () => {
  test('should not crash when generating audio with Piper on iOS', async ({ page }) => {
    // Increase timeout for this test as we're testing stability
    test.setTimeout(60000)

    page.on('console', (msg) => console.log(`[Browser] ${msg.text()}`))
    page.on('pageerror', (err) => console.error(`[Browser Error] ${err}`))

    // Load the application
    await page.goto('/')

    // Upload a sample book (using the small EPUB from other tests)
    // Upload a sample book
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles('books/test-short.epub')

    // Wait for book to load
    await expect(page.locator('h2', { hasText: 'Test Book' })).toBeVisible()

    // Select Piper TTS
    await page.getByLabel('🧠 Model').selectOption('piper')

    // Select a voice (should be auto-populated, but ensure one is selected)
    // Wait for voices to load
    await expect(page.getByLabel('🎤 Voice').locator('option')).not.toHaveCount(0)

    // Click Generate Audio
    const generateBtn = page.locator('button:has-text("Generate & Download")')
    await expect(generateBtn).toBeEnabled()
    await generateBtn.click()

    // Check for "Processing..." status
    await expect(page.locator('text=Processing...')).toBeVisible()

    // Wait for generation to complete (or crash)
    // If it crashes, the page might reload, resetting the state
    // We can check if the "Generate Audio" button becomes visible again without the "Generating..." text
    // OR check if we are back at the landing page (if persistent storage isn't working perfectly or if crash clears it)

    // Let's wait for the audio player to appear, which indicates success
    try {
      await expect(page.locator('audio')).toBeVisible({ timeout: 30000 })
    } catch (e) {
      // If we timeout, check if the page crashed/reloaded
      const isLandingPage = await page.locator('text=Drop your EPUB file here').isVisible()
      if (isLandingPage) {
        throw new Error('Page crashed and reloaded during generation!')
      }
      throw e
    }

    // Verify audio source is set
    const src = await page.locator('audio').getAttribute('src')
    expect(src).toBeTruthy()
  })
})
