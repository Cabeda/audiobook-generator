import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { installFakeTtsWorker, installReaderProbe, readProbe } from './helpers/readerProbe'
import { importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const EXAMPLE_ARTICLE = join(process.cwd(), 'example', 'esim_article.epub')

/**
 * E2E Test: Progressive Playback - No Regeneration
 *
 * This test verifies that clicking on an already-generated segment during
 * ongoing generation does NOT trigger regeneration. It should play immediately.
 *
 * Bug scenario:
 * 1. User starts generation for a book
 * 2. Some segments are generated and stored in segmentProgressStore
 * 3. User clicks on a generated segment (e.g., title/segment 0)
 * 4. BUG: playFromSegment doesn't check segmentProgressStore, tries to regenerate
 * 5. FIX: progressive segments are injected into audioService before playing
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so the
 * whole chain runs in seconds and every generation request is observable.
 */
test.describe('Progressive Playback - No Regeneration', () => {
  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', (msg) => {
      console.log('PAGE LOG:', msg.text())
    })

    await page.addInitScript(installReaderProbe)
    await page.addInitScript(installFakeTtsWorker)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Clear storage
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')

    await importAndOpen(page, EXAMPLE_ARTICLE, /eSIM/)

    // Start generation for the book in the background
    await openSettingsPanel(page)
    await settingsPanel(page).locator('button.action', { hasText: 'Generate audiobook' }).click()
    await page.locator('aside.settings button[aria-label="Close"]').click()
  })

  test('should not regenerate segment when clicked during generation', async ({ page }) => {
    // 1. Wait for the first segment to be generated
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 30000 })
    const firstGenerated = page.locator('.segment-generated').first()
    await expect(firstGenerated).toBeVisible()

    // 2. Record how often this segment has been requested so far
    const segmentText = (await firstGenerated.innerText()).trim()
    const countRequests = async () =>
      (await readProbe(page)).requestTexts.filter((text) => text.trim() === segmentText).length
    const preClickCount = await countRequests()
    expect(preClickCount).toBeGreaterThan(0)

    // 3. Click the generated segment
    await firstGenerated.click()

    // 4. It plays immediately…
    await expect(firstGenerated).toHaveClass(/active/, { timeout: 2000 })

    // 5. …and is NOT generated again
    await page.waitForTimeout(2000)
    expect(await countRequests()).toBe(preClickCount)
  })

  test('should play generated segment immediately when generation is in progress', async ({
    page,
  }) => {
    // 1. Wait for at least one generated segment while generation runs on
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1000)
    const generatedSegments = page.locator('.segment-generated')
    expect(await generatedSegments.count()).toBeGreaterThan(0)

    // 2. Track audio play events through the probe
    const playCountBefore = (await readProbe(page)).played

    // 3. Click a generated segment (not the currently generating one)
    const targetSegment = generatedSegments.first()
    await targetSegment.click()

    // 4. Verify playback started quickly (within a second — regeneration
    //    would mean a visible delay)
    await page.waitForTimeout(1000)
    expect((await readProbe(page)).played).toBeGreaterThan(playCountBefore)

    // Segment should be marked as active (playing)
    await expect(targetSegment).toHaveClass(/active/, { timeout: 2000 })
    await expect(page.locator('.transport')).toBeVisible()
  })
})
