import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import {
  importBookFile,
  importPanel,
  openSettingsPanel,
  settingsPanel,
  generateAudiobook,
} from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Kokoro TTS Caching', () => {
  test('should cache the model after first load', async ({ page }) => {
    test.setTimeout(300000) // 5 minutes, model download might be slow

    // Enable console log capture
    const consoleLogs: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      consoleLogs.push(text)
      if (text.includes('[KokoroCache]')) {
        console.log(`[PAGE] ${text}`)
      }
    })

    await page.goto('/')

    // Import the book — it opens on the reading surface
    const epubBuffer = await readFile(SHORT_EPUB)
    await importBookFile(page, {
      name: 'test.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })
    await expect(page.locator('.book-title')).toContainText(/Short Test Book/, { timeout: 20000 })

    // Select Kokoro TTS in the Aa settings panel
    await openSettingsPanel(page)
    await settingsPanel(page).locator('label.field:has-text("Model") select').selectOption('kokoro')

    // Generate (this triggers model download)
    console.log('Triggering first generation...')
    await generateAudiobook(page)

    // Wait for "Fetching and caching" log
    // The model loading logs might appear before generation starts fully
    await expect
      .poll(() => consoleLogs.some((l) => l.includes('[KokoroCache] Fetching and caching')), {
        message: 'Expected cache miss (fetching) log not found',
        timeout: 60000,
      })
      .toBeTruthy()

    // Wait for model load success
    await expect
      .poll(() => consoleLogs.some((l) => l.includes('Kokoro TTS model loaded successfully')), {
        message: 'Model failed to load',
        timeout: 120000,
      })
      .toBeTruthy()

    console.log('First generation model loaded. Reloading page...')

    // Reload page to test caching
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Re-open the book (storage might be cleared or not, but safe to re-import)
    await importBookFile(page, {
      name: 'test.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })
    await expect(page.locator('.book-title')).toContainText(/Short Test Book/, { timeout: 20000 })
    await expect(importPanel(page)).toBeHidden()

    // Select Kokoro again
    await openSettingsPanel(page)
    await settingsPanel(page).locator('label.field:has-text("Model") select').selectOption('kokoro')

    console.log('Triggering second generation...')
    await generateAudiobook(page)

    // Verify generation started
    await expect(page.locator('.prep')).toBeVisible({ timeout: 10000 })

    // Expect "Serving from cache" — the model must not be fetched again
    await expect
      .poll(
        () => {
          const hasCacheLog = consoleLogs.some((l) =>
            l.includes('[KokoroCache] Serving from cache')
          )
          return hasCacheLog
        },
        {
          message: 'Expected cache hit log not found',
          timeout: 30000,
        }
      )
      .toBeTruthy()
  })
})
