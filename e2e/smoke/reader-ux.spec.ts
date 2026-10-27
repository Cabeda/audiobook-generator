/**
 * Reader UX E2E tests.
 *
 * The pieces that keep a long book from becoming a trap: the offer to make a
 * book that has no audio, stopping a run, picking up a run that a closed tab
 * interrupted, keyboard reading, per-sentence re-making, Escape closing what
 * is open, and the device picker showing the default honestly.
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so no
 * model is downloaded.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'
import { installFakeTtsWorker, installReaderProbe, readProbe } from '../helpers/readerProbe'
import { clearAppStorage, generateAudiobook, importAndOpen, settingsPanel } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')
const GENERATION_STATE_KEY = 'audiobook_generation_state'

async function openFreshBook(
  page: import('@playwright/test').Page,
  worker: { delayMs?: number; audioMs?: number } = {}
): Promise<void> {
  await page.addInitScript(installReaderProbe)
  await page.addInitScript(installFakeTtsWorker, worker)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await clearAppStorage(page)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
}

test.describe('Reader UX', () => {
  test('offers to make a book that has no audio yet', async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshBook(page)

    await expect(page.locator('.prep.first-run')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.prep.first-run')).toContainText('No audio yet')

    // The offer opens the Aa panel, where the audiobook panel lives.
    await page.locator('.prep.first-run').click()
    await expect(settingsPanel(page)).toBeVisible()
  })

  test('stops a run from the strip and from the activity panel', async ({ page }) => {
    test.setTimeout(240_000)
    // Slow enough that the run is still going when Stop is pressed.
    await openFreshBook(page, { delayMs: 900, audioMs: 300 })

    await generateAudiobook(page)
    const preparing = page.locator('.prep', { hasText: 'Preparing audio' })

    // The strip itself can stop the run.
    await page.locator('.prep-stop').click()
    await expect(preparing).toBeHidden({ timeout: 60_000 })

    // And so can the activity panel.
    await generateAudiobook(page)
    await preparing.click()
    const panel = page.locator('[role="dialog"][aria-label="Generation activity"]')
    await expect(panel).toBeVisible()
    await panel.locator('button', { hasText: 'Stop' }).click()
    await expect(preparing).toBeHidden({ timeout: 60_000 })
    await expect(panel.locator('button', { hasText: 'Stop' })).toHaveCount(0)
  })

  test('offers to resume a run a closed tab interrupted', async ({ page }) => {
    test.setTimeout(180_000)
    await openFreshBook(page)

    // What a crash leaves behind: the book, and the chapters it had left.
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          bookId: 1,
          bookTitle: 'Short Test Book',
          chapterIds: ['chapter-1', 'chapter-2', 'chapter-3', 'chapter-4', 'chapter-5'],
          completedChapterIds: ['chapter-1', 'chapter-2'],
          currentChapterIndex: 2,
          startedAt: Date.now(),
          model: 'kokoro',
          voice: 'af_heart',
          quantization: 'q8',
          device: 'auto',
        })
      )
    }, GENERATION_STATE_KEY)
    await page.reload()
    await page.waitForLoadState('networkidle')

    const strip = page.locator('.prep.resume')
    await expect(strip).toBeVisible({ timeout: 15_000 })
    await expect(strip).toContainText('2/5')

    const before = (await readProbe(page)).requests
    await strip.locator('button', { hasText: 'Resume' }).click()
    await expect
      .poll(async () => (await readProbe(page)).requests, { timeout: 60_000 })
      .toBeGreaterThan(before)
  })

  test('reads from a sentence with the keyboard', async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshBook(page)

    const segment = page.locator('[data-section="2"] .segment').first()
    await segment.focus()
    await page.keyboard.press('Enter')

    await expect(page.locator('.transport')).toBeVisible({ timeout: 30_000 })
  })

  test('re-makes one sentence from its context menu', async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshBook(page)

    const segment = page.locator('[data-section="2"] .segment').first()
    const text = (await segment.innerText()).trim()
    const before = (await readProbe(page)).requests

    await segment.click({ button: 'right' })

    await expect
      .poll(
        async () => {
          const state = await readProbe(page)
          return state.requestTexts.slice(before).filter((request) => request.trim() === text)
            .length
        },
        { timeout: 60_000 }
      )
      .toBeGreaterThan(0)
  })

  test('closes the settings panel with Escape', async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshBook(page)

    await page.locator('button[aria-label="Settings"]').click()
    await expect(settingsPanel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(settingsPanel(page)).toBeHidden()
  })

  test('shows the default device in the picker', async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshBook(page)

    await page.locator('button[aria-label="Settings"]').click()
    await expect(settingsPanel(page)).toBeVisible()

    const device = settingsPanel(page).locator('label.field:has-text("Device") select')
    await expect(device).toHaveValue('auto')
  })
})
