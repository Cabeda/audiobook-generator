/**
 * Reader Reliability E2E Tests
 *
 * Tests smooth reading/listening experience on the new reading surface:
 * - Open reader and start playing ASAP from any selected text
 * - Verify correct model is used for generation
 * - Validate audio generation and playback
 * - Test progression through segments
 * - Works for all models (Kokoro, Piper, Web Speech)
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import { importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/** Mocks the Web Speech API, logging when it actually speaks. */
async function mockWebSpeech(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
      console.log('SPEECH_STARTED:', utterance.text.substring(0, 50))
      setTimeout(() => utterance.onstart?.({} as SpeechSynthesisEvent), 10)
      setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 100)
    }
    window.speechSynthesis.cancel = () => console.log('SPEECH_CANCELLED')
  })
}

/** Picks a model in the Aa settings panel without leaving the reader. */
async function selectModel(page: import('@playwright/test').Page, model: string): Promise<void> {
  await openSettingsPanel(page)
  await settingsPanel(page).locator('label.field:has-text("Model") select').selectOption(model)
  await page.locator('aside.settings button[aria-label="Close"]').click()
}

test.describe('Text Reader Reliability', () => {
  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', (msg) => {
      console.log(`[${msg.type()}]`, msg.text())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Clear storage for clean state
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Import the test book — it opens on the reading surface
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)
  })

  test('should switch models mid-playback and continue with new model', async ({ page }) => {
    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      logs.push(msg.text())
    })

    await mockWebSpeech(page)

    // Click the first segment to start playing with the current engine
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()
    await expect(firstSegment).toHaveClass(/active/, { timeout: 5000 })

    // Switch to Web Speech mid-playback
    await selectModel(page, 'web_speech')

    // The current segment is re-made with the new engine: no segment click needed
    await expect
      .poll(() => logs.some((log: string) => log.includes('SPEECH_STARTED')), { timeout: 30000 })
      .toBe(true)
  })

  test('should offer every registered engine in the reader model menu', async ({ page }) => {
    await openSettingsPanel(page)

    const models = await settingsPanel(page)
      .locator('label.field:has-text("Model") select option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))

    // The menu comes from MODEL_OPTIONS, so a new engine cannot be left out
    expect(models).toEqual(['web_speech', 'kokoro', 'piper', 'pocket', 'kitten'])
  })

  test('should allow voice changes in reader settings', async ({ page }) => {
    await openSettingsPanel(page)

    // Verify voice selector exists
    const voiceSelect = settingsPanel(page).locator('label.field:has-text("Voice") select')
    await expect(voiceSelect).toBeVisible()

    // Get available voices
    const voiceOptions = await voiceSelect.locator('option').count()
    expect(voiceOptions).toBeGreaterThan(1)

    // Change voice
    const secondVoice = await voiceSelect.locator('option').nth(1).getAttribute('value')
    if (secondVoice) {
      await voiceSelect.selectOption(secondVoice)
      await expect(voiceSelect).toHaveValue(secondVoice)
    }

    await page.locator('aside.settings button[aria-label="Close"]').click()
  })

  test('should persist Web Speech model selection across page refresh', async ({ page }) => {
    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      logs.push(msg.text())
    })

    await mockWebSpeech(page)

    await selectModel(page, 'web_speech')
    await page.waitForTimeout(500)

    // Reload the page and re-open the book from the library
    await page.reload()
    await page.waitForLoadState('networkidle')
    const emptyBooks = page.locator('.empty-link', { hasText: 'Your books' })
    if (await emptyBooks.isVisible().catch(() => false)) {
      await emptyBooks.click()
      await page
        .locator('.card', { hasText: 'Short Test Book' })
        .locator('button', { hasText: 'Read' })
        .click()
    }
    await expect(page.locator('.book-title')).toContainText(/Short Test Book/, { timeout: 15000 })

    // Open settings and verify Web Speech is still selected
    await openSettingsPanel(page)
    const modelSelect = settingsPanel(page).locator('label.field:has-text("Model") select')
    await expect(modelSelect).toHaveValue('web_speech')
    await page.locator('aside.settings button[aria-label="Close"]').click()

    // Click a segment - should use Web Speech
    logs.length = 0
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Verify Web Speech was used (not Kokoro)
    await expect
      .poll(() => logs.some((log: string) => log.includes('SPEECH_STARTED')), { timeout: 10000 })
      .toBe(true)
    expect(logs.some((log: string) => log.includes('KokoroClient'))).toBe(false)
  })

  test('should open reader and load segments immediately', async ({ page }) => {
    // Verify segments are rendered on the reading surface
    const segments = page.locator('.segment')
    await expect(segments.first()).toBeVisible({ timeout: 5000 })

    const segmentCount = await segments.count()
    expect(segmentCount).toBeGreaterThan(0)
  })

  test('should use Web Speech model and play immediately on segment click', async ({ page }) => {
    await mockWebSpeech(page)
    await selectModel(page, 'web_speech')

    // Click first segment
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Verify playback started (the transport shows the playing glyph)
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 5000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/)
  })

  test('should use Kokoro model and generate audio on demand', async ({ page }) => {
    test.setTimeout(120000) // 2 minutes for TTS generation

    await selectModel(page, 'kokoro')

    // Click first segment to trigger generation
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Verify generation started (segments flip to their generated state)
    await expect(page.locator('.segment-generated').first()).toBeVisible({ timeout: 60000 })

    // Wait for audio to be generated and playback to start
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 60000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })
  })

  test('should use Piper model and generate audio on demand', async ({ page }) => {
    test.setTimeout(120000) // 2 minutes for TTS generation

    await selectModel(page, 'piper')

    // Click first segment to trigger generation
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Wait for audio generation and playback
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 60000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })
  })

  test('should progress to next segment automatically', async ({ page }) => {
    // Use Web Speech for faster testing
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        console.log('SPEECH_SEGMENT:', utterance.text.substring(0, 30))
        setTimeout(() => utterance.onstart?.({} as SpeechSynthesisEvent), 10)
        setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 500) // End after 500ms
      }
    })
    await selectModel(page, 'web_speech')

    // Start playback from first segment
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Wait for first segment to be active
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })

    // Wait for progression to second segment
    const secondSegment = page.locator('[data-section="0"] .segment').nth(1)
    await expect(secondSegment).toHaveClass(/active|playing/, { timeout: 5000 })
  })

  test('should handle clicking different segments while playing', async ({ page }) => {
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as SpeechSynthesisEvent), 10)
      }
      window.speechSynthesis.cancel = () => console.log('CANCELLED')
    })
    await selectModel(page, 'web_speech')

    // Click first segment
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })

    // Click third segment while first is playing
    const thirdSegment = page.locator('[data-section="0"] .segment').nth(2)
    await thirdSegment.click()

    // Verify third segment is now active
    await expect(thirdSegment).toHaveClass(/active|playing/, { timeout: 5000 })

    // Verify first segment is no longer active
    await expect(firstSegment).not.toHaveClass(/active|playing/)
  })

  test('should persist playback position on pause/resume', async ({ page }) => {
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as SpeechSynthesisEvent), 10)
      }
      window.speechSynthesis.cancel = () => {}
    })
    await selectModel(page, 'web_speech')

    // Start playback from the second segment
    const secondSegment = page.locator('[data-section="0"] .segment').nth(1)
    await secondSegment.click()
    await expect(secondSegment).toHaveClass(/active|playing/, { timeout: 5000 })

    // Pause
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await playPauseBtn.click()
    await expect(playPauseBtn).toContainText('▶', { timeout: 2000 })

    // Verify segment is still highlighted (paused state)
    await expect(secondSegment).toHaveClass(/active|paused/)

    // Resume
    await playPauseBtn.click()
    await expect(playPauseBtn).toContainText('❚❚', { timeout: 2000 })

    // Verify same segment is still active
    await expect(secondSegment).toHaveClass(/active|playing/)
  })

  test('should show error state when generation fails', async ({ page }) => {
    await selectModel(page, 'kokoro')

    // Mock generation failure by blocking the model download
    await page.route('**/*', (route) => {
      if (route.request().url().includes('onnx') || route.request().url().includes('model')) {
        route.abort()
      } else {
        route.continue()
      }
    })

    // Click segment to trigger generation
    const firstSegment = page.locator('[data-section="0"] .segment').first()
    await firstSegment.click()

    // Verify error indicator appears (the error strip carries Retry/Dismiss)
    const errorStrip = page.locator('.error-strip')
    await expect(errorStrip).toBeVisible({ timeout: 20000 })
    await expect(errorStrip).toContainText('Retry')
  })

  test('should load reader quickly (< 2 seconds)', async ({ page }) => {
    const startTime = Date.now()

    // Re-import a book and wait for the reader to be fully loaded
    await page.locator('button[aria-label="Table of contents"]').click()
    await page.locator('.import-chip').click()
    await page
      .locator('[role="dialog"][aria-label="Add a book"] .drop input[type="file"]')
      .setInputFiles(SHORT_EPUB)
    await page.locator('.segment').first().waitFor({ state: 'visible' })

    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(2000) // Should load in under 2 seconds
  })

  test('should handle rapid segment clicks without breaking', async ({ page }) => {
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as SpeechSynthesisEvent), 10)
      }
      window.speechSynthesis.cancel = () => {}
    })
    await selectModel(page, 'web_speech')

    // Rapidly click multiple segments
    const segments = page.locator('[data-section="0"] .segment')
    for (let i = 0; i < 5; i++) {
      await segments.nth(i).click({ delay: 50 })
    }

    // Verify last clicked segment is active
    await expect(segments.nth(4)).toHaveClass(/active|playing/, { timeout: 5000 })

    // Verify playback is still functional
    const playPauseBtn = page.locator('.transport button[aria-label="Play or pause"]')
    await expect(playPauseBtn).toContainText('❚❚')
  })
})
