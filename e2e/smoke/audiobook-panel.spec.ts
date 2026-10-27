/**
 * Audiobook panel E2E test.
 *
 * The reader's Aa panel opens the audiobook panel instead of firing a
 * generation blind: it shows how far the book has come, what each chapter's
 * audio was made with, and offers to re-make the chapters left in another
 * voice with the one selected now.
 *
 * The TTS worker is replaced with one that answers with a canned WAV, so no
 * model is downloaded.
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'
import { installFakeTtsWorker } from '../helpers/readerProbe'
import {
  generateAudiobook,
  openSettingsPanel,
  settingsPanel,
  waitForGenerationIdle,
} from '../helpers/flows'
import { importAndOpen } from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

const activityPanel = (page: import('@playwright/test').Page) =>
  page.locator('[role="dialog"][aria-label="Generation activity"]')

test.describe('Audiobook panel', () => {
  test('shows the progress, the voice of each chapter and re-makes the stale ones', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    await page.addInitScript(installFakeTtsWorker)
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

    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // Make the whole book, then read what the panel says about it.
    await generateAudiobook(page)
    await waitForGenerationIdle(page)

    await openSettingsPanel(page)
    await settingsPanel(page)
      .locator('button.action', { hasText: /Audiobook progress/ })
      .click()
    const panel = activityPanel(page)
    await expect(panel).toBeVisible()

    // Progress overall, and the voice each chapter was made with.
    await expect(panel.locator('.summary p')).toContainText('ready')
    await expect(panel.locator('.voices').first()).toContainText('×')

    // Nothing is stale yet: no way to "match" anything.
    await expect(panel.locator('button', { hasText: 'Match current voice' })).toHaveCount(0)

    // Pick another voice: the chapters made already are now in the old one.
    await panel.locator('button[aria-label="Close"]').click()
    await openSettingsPanel(page)
    const voice = settingsPanel(page).locator('label.field:has-text("Voice") select')
    const currentVoice = await voice.inputValue()
    const otherVoice = await voice
      .locator('option')
      .evaluateAll(
        (options, current) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .find((value) => value !== current),
        currentVoice
      )
    await voice.selectOption(otherVoice as string)
    await page.locator('aside.settings button[aria-label="Close"]').click()

    await openSettingsPanel(page)
    await settingsPanel(page)
      .locator('button.action', { hasText: /Audiobook progress/ })
      .click()
    await expect(panel).toBeVisible()

    const matchAll = panel.locator('button', { hasText: 'Match current voice' })
    await expect(matchAll).toBeVisible()
    await expect(panel.locator('button', { hasText: 'Match voice' }).first()).toBeVisible()

    // Re-make the stale chapters in the selected voice; then there are none.
    await matchAll.click()
    await waitForGenerationIdle(page)
    await expect(panel.locator('button', { hasText: 'Match current voice' })).toHaveCount(0, {
      timeout: 120_000,
    })
  })
})
