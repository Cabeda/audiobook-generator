import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { exportAs, importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

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
    await page.reload()
    await page.waitForLoadState('networkidle')
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
    // The app opens straight into the reader's empty state
    await expect(page.locator('.empty-state h1')).toContainText(/Your library is empty/i)
  })

  test('should upload EPUB via touch on mobile', async ({ page }) => {
    const epubBuffer = await readFile(SHORT_EPUB)
    await importAndOpen(
      page,
      {
        name: 'test-short.epub',
        mimeType: 'application/epub+zip',
        buffer: epubBuffer,
      },
      /Short Test Book/
    )

    // The library card reports the chapter count
    await page.locator('button[aria-label="Books"]').tap()
    await expect(page.locator('section[aria-label="Books"] .card .meta').nth(1)).toContainText(
      /chapters/,
      { timeout: 10000 }
    )
  })

  test('should select q4 quantization on mobile for Kokoro', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Select Kokoro TTS in the Aa settings panel
    await openSettingsPanel(page)
    const panel = settingsPanel(page)
    await panel.locator('label.field:has-text("Model") select').selectOption('kokoro')

    // Mobile defaults to the lighter q4 quantization
    const quantSelect = panel.locator('label.field:has-text("Quantization") select')
    await expect(quantSelect).toBeVisible()
    await expect(quantSelect).toHaveValue('q4')
  })

  test('should generate audio on Mobile Chrome', async ({ page }) => {
    test.setTimeout(180000)

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Pick MP3 as the export format in the export sheet settings
    await openSettingsPanel(page)
    await settingsPanel(page)
      .locator('label.field:has-text("Export format") select')
      .selectOption('mp3')
    await page.locator('aside.settings button[aria-label="Close"]').tap()

    // Generate the first chapter by listening to it
    await page.locator('button[aria-label="Listen to this chapter"]').tap()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 30000 })
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 180000,
      })
      .toBe(await page.locator('[data-section="0"] .segment').count())

    // Export and verify the download
    const { filename, download } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()
    const saved = join(process.cwd(), 'test-results', 'mobile-export.mp3')
    await download.saveAs(saved)
    const buf = await readFile(saved)
    expect(buf.length).toBeGreaterThan(1000)
  })

  test('should generate audio on Mobile Firefox with WASM fallback', async ({ page }) => {
    test.setTimeout(180000)

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Force the WASM device — WebGPU is unavailable on mobile Firefox
    await openSettingsPanel(page)
    const panel = settingsPanel(page)
    await panel.locator('label.field:has-text("Device") select').selectOption('wasm')
    await panel.locator('label.field:has-text("Model") select').selectOption('kokoro')
    await page.locator('aside.settings button[aria-label="Close"]').tap()

    // Generate and export as MP3
    await page.locator('button[aria-label="Listen to this chapter"]').tap()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 30000 })
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 180000,
      })
      .toBe(await page.locator('[data-section="0"] .segment').count())

    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()
  })

  test('should handle touch interactions for chapter navigation', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Use tap instead of click for touch simulation: the chapter list lives
    // in the table of contents now
    await page.locator('button[aria-label="Table of contents"]').tap()
    const tocItems = page.locator('.toc-item')
    await expect(tocItems.first()).toBeVisible()
    const count = await tocItems.count()
    expect(count).toBeGreaterThanOrEqual(3)

    // Tap the last chapter to jump there
    await tocItems.nth(count - 1).tap()
    await expect(page.locator('.toc')).toBeHidden()
  })

  test('should open reader view with touch on mobile', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Tap the play control to start listening
    await page.locator('button[aria-label="Listen to this chapter"]').tap()

    // Verify the reading surface shows the chapter and the player is up
    await expect(page.locator('.chapter-title')).toBeVisible({ timeout: 10000 })
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPauseBtn).toBeVisible()
  })

  test('should handle playback controls via touch', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').tap()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 10000 })

    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')

    // Should be playing initially (auto-play)
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 10000 })

    // Tap to pause
    await playPauseBtn.tap()
    await expect(playPauseBtn).toContainText('▶', { timeout: 5000 })

    // Tap to resume
    await playPauseBtn.tap()
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 5000 })
  })

  test('should display progress correctly on mobile viewport', async ({ page }) => {
    test.setTimeout(120000)

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Start generating the book
    await openSettingsPanel(page)
    await settingsPanel(page).locator('button.action', { hasText: 'Generate audiobook' }).tap()
    await page.locator('aside.settings button[aria-label="Close"]').tap()

    // The progress strip is visible without horizontal scrolling
    const prep = page.locator('.prep')
    await expect(prep).toBeVisible({ timeout: 30000 })

    // Verify progress text is readable (not cut off)
    await expect(prep).toContainText(/Preparing audio… \d+%/)
  })
})
