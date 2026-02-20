/**
 * KittenTTS E2E test
 *
 * Generates a chapter audio file using KittenTTS and validates:
 * 1. The download is triggered with a .wav filename
 * 2. The WAV file has a valid RIFF header
 * 3. The audio duration is > 1 second (non-trivial content)
 * 4. The audio is not silent (RMS > threshold)
 * 5. Duration is proportional to text length (content sanity check)
 */

import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

// ── WAV validation helpers ────────────────────────────────────────────────────

function parseWavHeader(buf: Buffer) {
  const riff = buf.toString('ascii', 0, 4)
  if (riff !== 'RIFF') throw new Error(`Not a WAV file (got '${riff}')`)
  const numChannels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  const dataSize = buf.readUInt32LE(40)
  const numSamples = dataSize / (numChannels * (bitsPerSample / 8))
  const duration = numSamples / sampleRate
  return { sampleRate, numChannels, bitsPerSample, duration, dataSize }
}

function calculateRms(buf: Buffer, headerSize = 44, bitsPerSample = 16): number {
  const numSamples = (buf.length - headerSize) / (bitsPerSample / 8)
  let sumSq = 0
  for (let i = 0; i < numSamples; i++) {
    const sample = buf.readInt16LE(headerSize + i * 2) / 32768
    sumSq += sample * sample
  }
  return Math.sqrt(sumSq / numSamples)
}

// ── Test ──────────────────────────────────────────────────────────────────────

test.describe('KittenTTS E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-set model and voice in localStorage before page load so persisted stores
    // initialize with KittenTTS (avoids auto-generation starting with wrong model)
    await page.addInitScript(() => {
      localStorage.clear()
      localStorage.setItem('audiobook_model', JSON.stringify('kitten'))
      localStorage.setItem('audiobook_voice', JSON.stringify('Bella'))
    })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    page.on('console', (msg) => console.log(`[PAGE ${msg.type()}] ${msg.text()}`))
  })

  test('should generate chapter audio with KittenTTS and produce valid non-silent WAV', async ({
    page,
  }) => {
    test.setTimeout(360000) // 6 minutes — model download + inference

    // 1. Upload EPUB (auto-generation starts with KittenTTS+Bella from pre-set localStorage)
    const epubBuffer = await readFile(SHORT_EPUB)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })
    await page.waitForSelector('text=Short Test Book', { timeout: 15000 })

    // 2. Wait for auto-generation to complete (triggered on upload for all chapters)
    //    Wait for progress bars to appear then disappear.
    await page.waitForSelector('.progress-bar-bg', { timeout: 60000 }).catch(() => {})
    await page.waitForFunction(() => document.querySelectorAll('.progress-bar-bg').length === 0, {
      timeout: 300000,
      polling: 1000,
    })
    await page.waitForTimeout(1000)

    // 3. Verify KittenTTS model and Bella voice are active
    await expect(page.locator('select').first()).toHaveValue('kitten')
    await expect(page.locator('select option[value="Bella"]')).toBeAttached({ timeout: 5000 })

    // 4. Select only the first chapter and switch format to WAV
    await page.locator('button:has-text("Deselect All")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.waitForTimeout(300)

    // Open format dropdown (▾ toggle button) and select WAV
    await page.locator('button.export-toggle').click()
    await page.locator('button.format-option', { hasText: 'WAV' }).click()
    await page.waitForTimeout(300)

    // Capture the chapter text for content proportionality check
    const chapterText = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-chapter-text]')
      return items.length > 0 ? ((items[0] as HTMLElement).dataset.chapterText ?? '') : ''
    })

    // 5. Export already-generated audio as WAV (no re-generation needed)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('button.export-main').click(),
    ])

    // Wait for generation to complete (download fires when done)
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const filename = download.suggestedFilename()
    expect(filename).toMatch(/\.wav$/i)

    // 6. Validate WAV file
    const buf = await readFile(downloadPath!)

    // 6a. Valid RIFF header
    const wav = parseWavHeader(buf)
    expect(wav.sampleRate).toBe(24000)
    expect(wav.numChannels).toBe(1)
    expect(wav.bitsPerSample).toBe(16)

    // 6b. Duration > 1 second (non-trivial audio)
    expect(wav.duration).toBeGreaterThan(1)
    console.log(`[KittenTTS] Audio duration: ${wav.duration.toFixed(2)}s`)

    // 6c. Not silent — RMS > 0.001
    const rms = calculateRms(buf)
    expect(rms).toBeGreaterThan(0.001)
    console.log(`[KittenTTS] Audio RMS: ${rms.toFixed(5)}`)

    // 6d. Content proportionality: ~100-200 words/minute speech rate
    //     If we have chapter text, check duration is in a plausible range
    if (chapterText.length > 0) {
      const wordCount = chapterText.trim().split(/\s+/).length
      const minExpectedSec = (wordCount / 200) * 60 // fast speech
      const maxExpectedSec = (wordCount / 80) * 60 // slow speech
      console.log(
        `[KittenTTS] Words: ${wordCount}, expected ${minExpectedSec.toFixed(1)}-${maxExpectedSec.toFixed(1)}s, got ${wav.duration.toFixed(1)}s`
      )
      // Loose bounds — just sanity check it's not wildly off
      expect(wav.duration).toBeGreaterThan(minExpectedSec * 0.3)
      expect(wav.duration).toBeLessThan(maxExpectedSec * 3)
    }
  })
})
