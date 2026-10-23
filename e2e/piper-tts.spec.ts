import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { exportAs, importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Piper TTS E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should generate audio using Piper TTS', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    // Import the book
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

    // Select Piper TTS in the Aa settings panel
    await openSettingsPanel(page)
    const panel = settingsPanel(page)
    await panel.locator('label.field:has-text("Model") select').selectOption('piper')

    // Wait for voices to load and a default to be selected
    const voiceSelect = panel.locator('label.field:has-text("Voice") select')
    await expect
      .poll(async () => voiceSelect.locator('option').count(), { timeout: 10000 })
      .toBeGreaterThan(1)
    await expect(voiceSelect).not.toHaveValue('')

    // The panel reports how many chapters have audio so far
    await expect(panel).toContainText(/♪ \d+\/\d+ chapters ready/)

    // Generate the first chapter by listening to it
    await page.locator('aside.settings button[aria-label="Close"]').click()
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 15000 })

    // Wait for generation progress on the first chapter
    try {
      await expect(page.locator('text=/Downloading voice model/i')).toBeVisible({ timeout: 30000 })
    } catch {
      console.log('Model might have been cached or download was too fast to catch')
    }
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 60000 })

    // Export the generated audio as MP3
    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()
  })
})
