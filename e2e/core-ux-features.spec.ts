/**
 * Core UX Features E2E Tests
 *
 * Tests for the reading surface's core affordances:
 * - Skip controls (±15 seconds in the transport bar)
 * - Auto-follow of the spoken segment during playback
 * - Playback/progress persistence across reloads
 * - Toast container presence
 * - Playback speed setting
 *
 * The keyboard shortcuts and help overlay of the old reader are gone with the
 * old UI — the same intents (pause, skip, speed) are covered through the
 * transport bar and the Aa settings panel instead.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { clearAppStorage, importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/** The persisted playback position, in seconds. */
async function persistedTime(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('audiobook_player_state') || '{}').currentTime || 0
    } catch {
      return 0
    }
  })
}

test.describe('Core UX Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Start listening so the transport bar is up
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })
  })

  test('should skip 15 seconds forward and backward', async ({ page }) => {
    // Let a little audio play first
    await page.waitForTimeout(1500)

    const before = await persistedTime(page)

    // Skip forward
    await page.locator('.transport button[aria-label="Forward 15 seconds"]').click()
    await page.waitForTimeout(500)
    const afterForward = await persistedTime(page)
    expect(afterForward).toBeGreaterThan(before)

    // Skip backward
    await page.locator('.transport button[aria-label="Back 15 seconds"]').click()
    await page.waitForTimeout(500)
    const afterBack = await persistedTime(page)
    expect(afterBack).toBeLessThan(afterForward)
  })

  test('should auto-scroll to current segment during playback', async ({ page }) => {
    // Click a segment further down the chapter
    const segments = page.locator('[data-section="0"] .segment')
    const target = segments.nth(Math.min((await segments.count()) - 1, 5))
    await target.click()

    // The spoken segment gets highlighted and the view follows it
    const active = page.locator('.segment.active').first()
    await expect(active).toBeVisible({ timeout: 10000 })

    const inView = await page.evaluate(() => {
      const root = document.querySelector('.reader')
      const segment = document.querySelector('.segment.active')
      if (!root || !segment) return false
      const r = segment.getBoundingClientRect()
      const b = root.getBoundingClientRect()
      return r.top >= b.top && r.bottom <= b.bottom
    })
    expect(inView).toBe(true)
  })

  test('should persist playback position across page reloads', async ({ page }) => {
    // Start from a later segment so there is a position to restore
    const segments = page.locator('[data-section="0"] .segment')
    await segments.nth(3).click()
    await expect(segments.nth(3)).toHaveClass(/active/, { timeout: 5000 })
    await page.waitForTimeout(500)

    const before = await page.evaluate(() => {
      const parsed = JSON.parse(localStorage.getItem('audiobook_player_state') || '{}')
      return { segment: parsed.segmentIndex ?? -1, time: parsed.currentTime ?? 0 }
    })
    expect(before.segment).toBeGreaterThanOrEqual(3)

    await page.reload()
    await page.waitForLoadState('networkidle')

    const after = await page.evaluate(() => {
      const parsed = JSON.parse(localStorage.getItem('audiobook_player_state') || '{}')
      return { segment: parsed.segmentIndex ?? -1, time: parsed.currentTime ?? 0 }
    })
    expect(after.segment).toBeGreaterThanOrEqual(before.segment - 1)
    expect(Math.abs(after.time - before.time)).toBeLessThanOrEqual(3)
  })

  test('should display toast container', async ({ page }) => {
    // Verify the toast container exists in the DOM
    const toastContainer = page.locator('.toast-container')
    await expect(toastContainer).toBeAttached()
  })

  test('should change playback speed from settings', async ({ page }) => {
    await openSettingsPanel(page)
    const speedSelect = settingsPanel(page).locator('label.field:has-text("Speed") select')
    await expect(speedSelect).toBeVisible()

    await speedSelect.selectOption('2')
    await expect(speedSelect).toHaveValue('2')

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const parsed = JSON.parse(localStorage.getItem('audiobook_player_state') || '{}')
            return parsed.playbackSpeed ?? 1
          }),
        { timeout: 5000 }
      )
      .toBe(2)
  })
})
