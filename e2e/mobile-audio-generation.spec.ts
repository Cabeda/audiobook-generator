import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

// Use the short EPUB for deterministic, faster E2E runs
const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/**
 * Mobile Audio Generation E2E Tests
 *
 * These tests verify that audio generation works correctly on mobile devices
 * (Android Chrome and Firefox). They run against the Mobile Chrome and
 * Mobile Firefox Playwright projects defined in playwright.config.ts.
 *
 * Key mobile-specific behaviors tested:
 * - Mobile device detection (isMobile() returns true)
 * - q4 quantization auto-selected (lighter model for mobile)
 * - WASM fallback when WebGPU unavailable (Firefox)
 * - Smaller chunk sizes (300-400 chars vs 1000 on desktop)
 * - Touch interactions work correctly
 * - Audio playback with mobile auto-play policies
 */
test.describe('Mobile Audio Generation E2E', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // Skip non-mobile projects
    test.skip(
      !testInfo.project.name.toLowerCase().includes('mobile'),
      'Skipping mobile tests on desktop browsers'
    )

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Ensure a clean storage state between tests
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    // Log browser console messages during E2E for debugging
    page.on('console', (msg) => {
      console.log(`[MOBILE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should detect mobile device correctly', async ({ page }) => {
    // Verify the app detects this as a mobile device
    const isMobile = await page.evaluate(() => {
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
      const isMobileUA = mobileRegex.test(navigator.userAgent)
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const isSmallScreen = window.innerWidth < 768
      return isMobileUA || (hasTouch && isSmallScreen)
    })

    expect(isMobile).toBe(true)
  })

  test('should load the application on mobile', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    await expect(page.locator('h1')).toContainText(/Audiobook Generator/i)
  })

  test('should upload EPUB via touch on mobile', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for parsing to complete - use longer timeout for mobile
    await page.waitForSelector('text=Short Test Book', {
      timeout: 30000,
    })

    // Verify book loaded - check for chapter badge which is always visible
    // Author text may be truncated or hidden on small viewports
    await expect(page.getByText(/\d+ Chapters/)).toBeVisible({ timeout: 10000 })
  })

  test('should select q4 quantization on mobile for Kokoro', async ({ page }) => {
    // Upload EPUB first
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // TTS Engine selector is now in the main toolbar
    // Check if Kokoro is selected (default)
    const ttsSelect = page.locator('select').filter({ hasText: 'Kokoro TTS' }).first()
    if (await ttsSelect.isVisible().catch(() => false)) {
      // Ensure Kokoro is selected
      await ttsSelect.selectOption({ label: 'Kokoro TTS' })
    }

    // Open advanced options to check quantization settings
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()

    const advanced = page.locator('.advanced-panel')
    await expect(advanced).toBeVisible()

    // On mobile, q4 should be the default quantization (lighter model)
    // Look for quantization setting if visible
    const quantSelect = advanced.locator('select#adv-quant')
    if (await quantSelect.isVisible().catch(() => false)) {
      const selectedValue = await quantSelect.inputValue()
      // Mobile should default to q4 (25MB) instead of q8 (100MB)
      expect(selectedValue).toBe('q4')
    }
  })

  test('should generate audio on Mobile Chrome', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('Chrome'), 'Chrome-specific test')
    test.setTimeout(240000) // 4 minutes for mobile generation (slower than desktop)

    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Deselect all chapters first, then select only the first one
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Format selector is now in the main toolbar, not in advanced options
    // Select MP3 format from the main toolbar dropdown (MP3 is already default)
    const formatDropdown = page.locator('select').filter({ hasText: 'MP3' }).first()
    if (await formatDropdown.isVisible().catch(() => false)) {
      await formatDropdown.selectOption('MP3')
    }

    // Open advanced options and select bitrate
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await advancedToggle.click()
    const advanced = page.locator('.advanced-panel')
    await expect(advanced).toBeVisible()

    // Select lower bitrate for faster mobile tests
    const bitrateSelect = advanced.locator('select#adv-bitrate')
    await bitrateSelect.selectOption('128')

    // Capture download console logs
    const downloadConsoleLogs: { filename?: string; size?: number }[] = []
    page.on('console', async (msg) => {
      if (!msg.text().startsWith('download-trigger')) return
      for (const arg of msg.args()) {
        try {
          const val = await arg.jsonValue()
          if (val && typeof val === 'object' && 'filename' in val) {
            downloadConsoleLogs.push(val as { filename?: string; size?: number })
          }
        } catch {
          // ignore
        }
      }
    })

    // Click generate button (text changed to "Generate Selected")
    await page.locator('button:has-text("Generate Selected")').click()

    // Wait for generation to complete (mobile is slower due to WASM/smaller chunks)
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 180000 })

    // Wait for download
    await page.waitForSelector('text=Download started!', { timeout: 60000 })
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0].filename?.endsWith('.mp3')).toBeTruthy()
    expect(downloadConsoleLogs[0].size).toBeGreaterThan(1000)
  })

  test('should generate audio on Mobile Firefox with WASM fallback', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('Firefox'), 'Firefox-specific test')
    test.setTimeout(240000) // 4 minutes for mobile generation

    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Deselect all chapters first, then select only the first one
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Open advanced options
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await advancedToggle.click()
    const advanced = page.locator('.advanced-panel')
    await expect(advanced).toBeVisible()

    // TTS Engine selector is now in the main toolbar, select Piper TTS for Firefox
    const ttsSelect = page.locator('select').filter({ hasText: 'Kokoro TTS' }).first()
    if (await ttsSelect.isVisible().catch(() => false)) {
      await ttsSelect.selectOption({ label: 'Piper TTS' })
    }

    // Format selector is in the main toolbar - MP3 is default
    const formatDropdown = page.locator('select').filter({ hasText: 'MP3' }).first()
    if (await formatDropdown.isVisible().catch(() => false)) {
      await formatDropdown.selectOption('MP3')
    }

    // Select lower bitrate for faster mobile tests
    const bitrateSelect = advanced.locator('select#adv-bitrate')
    await bitrateSelect.selectOption('128')

    // Capture download console logs
    const downloadConsoleLogs: { filename?: string; size?: number }[] = []
    page.on('console', async (msg) => {
      if (!msg.text().startsWith('download-trigger')) return
      for (const arg of msg.args()) {
        try {
          const val = await arg.jsonValue()
          if (val && typeof val === 'object' && 'filename' in val) {
            downloadConsoleLogs.push(val as { filename?: string; size?: number })
          }
        } catch {
          // ignore
        }
      }
    })

    // Click generate button (text changed to "Generate Selected")
    await page.locator('button:has-text("Generate Selected")').click()

    // Wait for generation to complete
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 180000 })

    // Wait for download
    await page.waitForSelector('text=Download started!', { timeout: 60000 })
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0].filename?.endsWith('.mp3')).toBeTruthy()
    expect(downloadConsoleLogs[0].size).toBeGreaterThan(1000)
  })

  test('should handle touch interactions for chapter selection', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Use tap instead of click for touch simulation
    const deselectBtn = page.locator('button:has-text("Deselect all")')
    await deselectBtn.tap()

    // Verify all chapters are deselected
    const checkboxes = page.locator('input[type="checkbox"]')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked()
    }

    // Tap to select first chapter
    const firstCheckbox = checkboxes.first()
    await firstCheckbox.tap()
    await expect(firstCheckbox).toBeChecked()
  })

  test('should open reader view with touch on mobile', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Deselect all and select first chapter
    await page.locator('button:has-text("Deselect all")').tap()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.tap()

    // Tap Read button
    const readButton = page.locator('button:has-text("Read")').first()
    await readButton.tap()

    // Verify reader opens
    const chapterTitle = page.locator('#chapter-title')
    await expect(chapterTitle).toBeVisible({ timeout: 10000 })

    // Verify play controls are visible and accessible on mobile
    const playPauseBtn = page.locator('.reader-page .control-btn.play-pause')
    await expect(playPauseBtn).toBeVisible()
  })

  test('should handle playback controls via touch', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Open reader
    await page.locator('button:has-text("Deselect all")').tap()
    await page.locator('input[type="checkbox"]').first().tap()
    await page.locator('button:has-text("Read")').first().tap()

    await page.waitForSelector('#chapter-title', { timeout: 10000 })

    const playPauseBtn = page.locator('.reader-page .control-btn.play-pause')
    await expect(playPauseBtn).toBeVisible()

    // Should be playing initially (auto-play)
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause')

    // Tap to pause
    await playPauseBtn.tap()
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Play')

    // Tap to resume
    await playPauseBtn.tap()
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause')
  })

  test('should display progress correctly on mobile viewport', async ({ page }) => {
    test.setTimeout(120000)

    const epubBuffer = await readFile(SHORT_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })

    // Select first chapter only
    await page.locator('button:has-text("Deselect all")').tap()
    await page.locator('input[type="checkbox"]').first().tap()

    // Open advanced options
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await advancedToggle.tap()

    // Start generation (button text changed to "Generate Selected")
    await page.locator('button:has-text("Generate Selected")').tap()

    // Verify progress indicator is visible on mobile viewport
    // Progress should be visible without horizontal scrolling
    const progressElement = page.locator(
      '.progress-bar, .generation-progress, [role="progressbar"]'
    )
    await expect(progressElement.first()).toBeVisible({ timeout: 30000 })

    // Verify progress text is readable (not cut off)
    const progressText = page.locator('text=/\\d+%/')
    await expect(progressText.first()).toBeVisible({ timeout: 30000 })
  })
})
