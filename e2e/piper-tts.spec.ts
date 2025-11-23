import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

test.describe('Piper TTS E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should generate audio using Piper TTS', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-short.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Select Piper TTS
    const modelSelect = page.locator('label:has-text("Model") select')
    await modelSelect.selectOption('piper')

    // Wait for voices to load and default to be selected
    const defaultVoiceOption = page.locator(
      'label:has-text("Voice") select option[value="en_US-hfc_female-medium"]'
    )
    await expect(defaultVoiceOption).toBeAttached({ timeout: 10000 })

    const voiceSelect = page.locator('label:has-text("Voice") select')
    await expect(voiceSelect).toHaveValue('en_US-hfc_female-medium', { timeout: 10000 })

    // Deselect all, then select first chapter
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Verify chapter is selected
    await expect(page.locator('text=Selected: 1')).toBeVisible({ timeout: 10000 })

    // Capture download logs
    const downloadConsoleLogs: any[] = []
    page.on('console', async (msg) => {
      if (!msg.text().startsWith('download-trigger')) return
      for (const arg of msg.args()) {
        try {
          const val = await arg.jsonValue()
          if (val && typeof val === 'object' && 'filename' in val) downloadConsoleLogs.push(val)
        } catch {
          // ignore
        }
      }
    })

    // Click Generate & Download
    const generateButton = page.locator('button:has-text("Generate & Download")')
    await expect(generateButton).toBeEnabled({ timeout: 10000 })
    await generateButton.click()

    // Wait for model download (progress text)
    // Note: The exact text might vary, but we expect some progress indication
    try {
      await expect(page.locator('text=/Downloading voice model/i')).toBeVisible({ timeout: 30000 })
    } catch {
      console.log('Model might have been cached or download was too fast to catch')
    }

    // Wait for generation progress
    await expect(page.locator('text=/Chapter 1\\//i')).toBeVisible({ timeout: 60000 })

    // Wait for completion
    await page.waitForSelector('text=Download started!', { timeout: 120000 })

    // Verify download triggered
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0].filename?.endsWith('.mp3')).toBeTruthy()
    expect(downloadConsoleLogs[0].size).toBeGreaterThan(1000)
  })
})
