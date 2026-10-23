/**
 * E2E test: export MP3 for a multi-segment chapter.
 * Reproduces the "Failed to concatenate segments" error when segments have
 * mismatched WAV formats from Kokoro TTS.
 */
import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { exportAs, importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('MP3 Export - Multi-segment chapter', () => {
  test('should export a multi-segment chapter as MP3 without concatenation error', async ({
    page,
  }) => {
    test.setTimeout(120000)

    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Import EPUB
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

    // Generate every chapter — the second one has multiple segments, which is
    // where the concatenation used to break.
    await openSettingsPanel(page)
    await settingsPanel(page).locator('button.action', { hasText: 'Generate audiobook' }).click()
    await page.locator('aside.settings button[aria-label="Close"]').click()

    await expect
      .poll(async () => page.locator('.segment-generated').count(), { timeout: 90000 })
      .toBe(await page.locator('.segment').count())

    // Clear console before export
    consoleMessages.length = 0

    // Export the whole book as MP3 through the export sheet
    const { filename } = await exportAs(page, 'mp3')
    expect(filename?.endsWith('.mp3')).toBeTruthy()

    // Check results
    const hasConcatError = consoleMessages.some((m) => m.includes('Failed to concatenate'))
    const hasEncodingError = consoleMessages.some((m) => m.includes('ENCODING_ERROR'))
    const hasExportFailed = consoleMessages.some((m) => m.includes('Export failed'))

    console.log(
      'Console messages after export:',
      consoleMessages.filter(
        (m) =>
          m.includes('ERROR') ||
          m.includes('WARN') ||
          m.includes('Export') ||
          m.includes('mediabunny') ||
          m.includes('concat')
      )
    )

    expect(hasConcatError).toBe(false)
    expect(hasEncodingError).toBe(false)
    expect(hasExportFailed).toBe(false)
  })
})
