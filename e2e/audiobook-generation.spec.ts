import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import {
  clearAppStorage,
  exportAs,
  exportSheet,
  generateAudiobook,
  importAndOpen,
  openBooksOverlay,
  openExportSheet,
} from './helpers/flows'

// Use the short EPUB for deterministic, faster E2E runs
const EXAMPLE_EPUB = join(process.cwd(), 'books', 'test-short.epub')
const SHORT_EPUB = EXAMPLE_EPUB

test.describe('Audiobook Generation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Ensure a clean storage state between tests to avoid cached example uploads
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
    // Log browser console messages during E2E for debugging
    page.on('console', (msg) => {
      // Print page console messages to Playwright output for easier debugging
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    // The app opens straight into the reader's empty state — no landing page
    await expect(page.locator('.empty-state h1')).toContainText(/Turn any book into an audiobook/i)
    await expect(page.locator('.empty-cta')).toContainText(/Add a book/i)
  })

  test('should upload EPUB and display book info', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Book metadata in the library overlay
    await openBooksOverlay(page)
    const card = page.locator('.card', { hasText: 'Short Test Book' })
    await expect(card.locator('h3')).toContainText('Short Test Book')
    await expect(card.locator('.meta').first()).toContainText('Test Author')
    await expect(card.locator('.meta').nth(1)).toContainText(/chapters/)

    // Per-book detail carries the author and the chapter count too
    await card.locator('button', { hasText: 'Details' }).click()
    const detail = page.locator('section[aria-label="Book details"]')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('Test Author')
    await expect(detail).toContainText(/chapters/)
    await expect(detail.locator('.row')).toHaveCount(3)
  })

  test('should generate single chapter as MP3', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for the entire test

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Listening to the chapter generates just that chapter's audio
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    // Progress while generation runs
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 120000 })

    // Wait for the whole first chapter to be generated
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 120000,
      })
      .toBeGreaterThan(0)
    const chapterSegments = await page.locator('[data-section="0"] .segment').count()
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 120000,
      })
      .toBe(chapterSegments)

    // Export the generated chapter as MP3 with a chosen bitrate
    await openExportSheet(page)
    const sheet = exportSheet(page)
    await sheet.locator('label.field:has-text("Bitrate") select').selectOption('192')
    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()
  })

  test('should generate single chapter as M4B', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for M4B generation

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })
    const chapterSegments = await page.locator('[data-section="0"] .segment').count()
    await expect
      .poll(async () => page.locator('[data-section="0"] .segment-generated').count(), {
        timeout: 120000,
      })
      .toBe(chapterSegments)

    await openExportSheet(page)
    const sheet = exportSheet(page)
    await sheet.locator('label.field:has-text("Bitrate") select').selectOption('128')
    const { filename } = await exportAs(page, 'm4b')
    expect(filename).toMatch(/\.m4b$/)
  })

  test('should start playback when clicking Listen', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()

    // The transport bar appears and reports the chapter being played
    const transport = page.locator('.transport')
    await expect(transport).toBeVisible({ timeout: 15000 })
    await expect(transport.locator('.t-title')).toContainText(/Chapter/i)
    // The play/pause control shows the playing glyph while audio runs
    await expect(transport.locator('button[aria-label="Play or pause"]')).toContainText('❚❚', {
      timeout: 15000,
    })
  })

  test('transport play/pause toggles playback on and off', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()
    const playPause = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPause).toContainText('❚❚', { timeout: 15000 })

    // Press pause
    await playPause.click()
    await expect(playPause).toContainText('▶', { timeout: 5000 })

    // Press play again
    await playPause.click()
    await expect(playPause).toContainText('❚❚', { timeout: 5000 })
  })

  test('should stay on reader after page reload', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Reload and ensure we remain on the reader surface and same book
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.book-title')).toContainText(/Short Test Book/, { timeout: 15000 })
    // Hash should be a reader route
    const hash = await page.evaluate(() => location.hash)
    expect(hash.startsWith('#/reader/')).toBeTruthy()
  })

  test('should restore playback position after page reload', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    // Wait a bit for playback progress
    await page.waitForTimeout(2000)
    // Read persisted playback time from localStorage
    const startSeconds = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('audiobook_player_state')
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        return Math.floor(parsed.currentTime || 0)
      } catch {
        return 0
      }
    })

    // Reload and wait for the player to re-initialize
    await page.reload()
    await page.waitForFunction(() => !!localStorage.getItem('audiobook_player_state'))
    const afterSeconds = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('audiobook_player_state')
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        return Math.floor(parsed.currentTime || 0)
      } catch {
        return 0
      }
    })

    // The restored time should be close to the previous time (within 3 seconds)
    expect(Math.abs(afterSeconds - startSeconds)).toBeLessThanOrEqual(3)
  })

  test('should keep playing when opening the books overlay', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()
    const playPause = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPause).toContainText('❚❚', { timeout: 15000 })

    // Navigate away from the reading surface — the audio keeps going
    await openBooksOverlay(page)
    await expect(playPause).toContainText('❚❚')
    await page.locator('section[aria-label="Books"] button[aria-label="Close"]').click()
    await expect(playPause).toContainText('❚❚')
  })

  test('should show chapter duration (>= segment duration) in persistent player', async ({
    page,
  }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    // Wait a bit for initial generation & store update
    await page.waitForTimeout(1500)

    // Read persisted player state
    const parsedState = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('audiobook_player_state') || '{}')
      } catch {
        return {}
      }
    })

    expect(parsedState.chapterDuration).toBeGreaterThanOrEqual(parsedState.duration)
  })

  test('should generate all chapters as MP3', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for the chapters

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Generate the whole book from the Aa settings panel
    await generateAudiobook(page)

    // The generation progress strip tracks the whole book
    await expect(page.locator('.prep')).toContainText(/Preparing audio…/, { timeout: 30000 })

    // Wait until every segment of the book is generated
    await expect
      .poll(async () => page.locator('.segment-generated').count(), { timeout: 180000 })
      .toBe(await page.locator('.segment').count())

    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()
  })

  test('should generate all chapters as M4B', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for the chapters

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await generateAudiobook(page)

    await expect
      .poll(async () => page.locator('.segment-generated').count(), { timeout: 180000 })
      .toBe(await page.locator('.segment').count())

    const { filename } = await exportAs(page, 'm4b')
    expect(filename).toMatch(/\.m4b$/)
  })

  test('should show progress during generation', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await generateAudiobook(page)

    // The progress strip is visible while audio is being prepared
    await expect(page.locator('.prep')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('.prep')).toContainText(/Preparing audio… \d+%/)

    // And it goes away once generation is done
    await expect(page.locator('.prep', { hasText: 'Preparing audio' })).toBeHidden({
      timeout: 180000,
    })
  })

  test('should allow format and bitrate selection', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
    await openExportSheet(page)

    const sheet = exportSheet(page)
    // Verify format dropdown exists and has correct options
    const formatSelect = sheet.locator('label.field:has-text("Format") select')
    await expect(formatSelect).toBeVisible()
    const formatOptions = await formatSelect.locator('option').allTextContents()
    expect(formatOptions).toContain('MP3')
    expect(formatOptions).toContain('M4B Audiobook')
    expect(formatOptions).toContain('WAV')

    // Verify bitrate options exist
    const bitrateSelect = sheet.locator('label.field:has-text("Bitrate") select')
    await expect(bitrateSelect).toBeVisible()
    const bitrateOptions = await bitrateSelect.locator('option').allTextContents()
    const commonBits = ['64', '96', '128', '192']
    expect(bitrateOptions.some((opt) => commonBits.some((s) => opt.includes(s)))).toBeTruthy()
  })

  test('should stop playback with the close player control', async ({ page }) => {
    test.setTimeout(120000)

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.transport button[aria-label="Play or pause"]')).toContainText('❚❚')

    // Stopping the player tears the transport down (the old generation
    // Cancel control is gone — stopping is what the reader offers now)
    await page.locator('.transport button[aria-label="Close player"]').click()
    await expect(page.locator('.transport')).toBeHidden({ timeout: 5000 })
    await expect(page.locator('.segment').first()).toBeVisible()
  })

  test('should show the generating state while playing', async ({ page }) => {
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    // While audio plays, the not-yet-made sentences show their state in place
    await expect(page.locator('.segment-generating, .segment-pending').first()).toBeVisible({
      timeout: 15000,
    })
  })

  test('welcome tour leads to the import panel', async ({ page }) => {
    // The old auto-shown onboarding banner is gone; the tour is now an
    // explicit flow from the empty state.
    await page.locator('.empty-link', { hasText: 'Take the tour' }).click()
    const tour = page.locator('[role="dialog"][aria-label="Welcome"]')
    await expect(tour).toBeVisible()

    await tour.locator('button.go', { hasText: 'Get started' }).click()
    await tour.locator('button.go', { hasText: 'Continue' }).click()
    await expect(tour).toContainText(/Add your first book/i)

    await tour.locator('button.go', { hasText: 'Add a book' }).click()
    await expect(page.locator('[role="dialog"][aria-label="Add a book"]')).toBeVisible()
  })
})
