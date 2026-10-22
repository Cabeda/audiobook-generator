/**
 * Reader settings E2E test.
 *
 * The reader's model and voice pickers come from the engine registry, and a
 * change made there applies to the current and the following segments — the
 * listener must not have to click a segment for it to take effect.
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so no
 * model is downloaded. The nightly engine tests cover the real engines.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'
import {
  installFakeTtsWorker,
  installReaderProbe,
  openReader,
  readProbe,
} from '../helpers/readerProbe'

const EXAMPLE_ARTICLE = join(process.cwd(), 'example', 'esim_article.epub')

async function openCleanReader(page: import('@playwright/test').Page): Promise<number> {
  await page.addInitScript(installReaderProbe)
  // Long segments, so the test has time to change settings mid-playback.
  await page.addInitScript(installFakeTtsWorker, { audioMs: 3000 })

  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    const databases = await indexedDB.databases()
    await Promise.all(
      databases.map((database) => {
        if (!database.name) return Promise.resolve()
        return new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(database.name as string)
          request.onsuccess = () => resolve()
          request.onerror = () => resolve()
          request.onblocked = () => resolve()
        })
      })
    )
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.reload()
  await page.waitForLoadState('networkidle')

  return openReader(page, EXAMPLE_ARTICLE, /eSIM/)
}

test.describe('Reader settings', () => {
  test('offers every registered engine in the model menu', async ({ page }) => {
    test.setTimeout(120_000)
    await openCleanReader(page)

    await page.locator('button[aria-label="Settings"]').click()
    await expect(page.locator('.settings-menu')).toBeVisible()

    const models = await page
      .locator('#model-select option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))

    expect(models).toEqual(['web_speech', 'kokoro', 'piper', 'pocket', 'kitten'])
  })

  test('applies a voice change to the playing segment without a click', async ({ page }) => {
    test.setTimeout(120_000)
    const segmentCount = await openCleanReader(page)
    expect(segmentCount).toBeGreaterThan(2)

    // Wait for the first segment to start playing.
    await expect
      .poll(async () => (await readProbe(page)).active.length, { timeout: 60_000 })
      .toBe(1)
    const before = await readProbe(page)
    const playingText = await page.locator('.segment.active').first().innerText()
    const playingIndex = before.active[before.active.length - 1]

    // Change the voice while it plays.
    await page.locator('button[aria-label="Settings"]').click()
    await expect(page.locator('.settings-menu')).toBeVisible()
    const voiceSelect = page.locator('#voice-select')
    const currentVoice = await voiceSelect.inputValue()
    const otherVoice = await voiceSelect
      .locator('option')
      .evaluateAll(
        (options, current) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .find((value) => value !== current),
        currentVoice
      )
    expect(otherVoice).toBeTruthy()
    await voiceSelect.selectOption(otherVoice as string)
    await page.locator('.close-settings').click()

    // The segment that was playing is made again with the new voice, with no click.
    await expect
      .poll(async () => (await readProbe(page)).requestTexts.slice(before.requestTexts.length), {
        timeout: 30_000,
      })
      .toContain(playingText.trim())

    // And playback carries on from where it was instead of stopping.
    await expect
      .poll(async () => (await readProbe(page)).active.at(-1), { timeout: 30_000 })
      .toBeGreaterThan(playingIndex)
  })
})
