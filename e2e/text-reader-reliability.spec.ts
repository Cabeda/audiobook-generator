/**
 * Text Reader Reliability E2E Tests
 *
 * Tests smooth text reader experience:
 * - Open reader and start playing ASAP from any selected text
 * - Verify correct model is used for generation
 * - Validate audio generation and playback
 * - Test progression through segments
 * - Works for all models (Kokoro, Piper, Web Speech)
 */

import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

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

    // Upload test book
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(SHORT_EPUB)
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })
  })

  test('should switch models mid-playback and continue with new model', async ({ page }) => {
    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      logs.push(msg.text())
    })

    // Mock Web Speech API
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        console.log('SPEECH_STARTED:', utterance.text.substring(0, 50))
        setTimeout(() => utterance.onstart?.({} as any), 10)
        setTimeout(() => utterance.onend?.({} as any), 100)
      }
      window.speechSynthesis.cancel = () => console.log('SPEECH_CANCELLED')
    })

    // Open reader with Kokoro
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')
    await page.waitForSelector('.segment', { timeout: 5000 })

    // Click first segment to start playback with Kokoro
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Wait for generation to start
    await page.waitForTimeout(1000)

    // Switch to Web Speech mid-playback
    const settingsBtn = page.locator('button[aria-label="Settings"]')
    await settingsBtn.click()
    await page.waitForSelector('.settings-menu')

    const settingsModelSelect = page.locator('#model-select')
    await settingsModelSelect.selectOption('web_speech')

    // Close settings
    const closeBtn = page.locator('.close-settings')
    await closeBtn.click()
    await page.waitForTimeout(500)

    // Click second segment - should use Web Speech now
    const secondSegment = page.locator('.segment').nth(1)
    await secondSegment.click()

    // Wait for speech to start
    await page.waitForTimeout(500)

    // Verify Web Speech was used
    expect(logs.some((log: string) => log.includes('SPEECH_STARTED'))).toBe(true)
  })

  test('should allow voice changes in text reader settings', async ({ page }) => {
    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Open settings
    const settingsBtn = page.locator('button[aria-label="Settings"]')
    await settingsBtn.click()
    await page.waitForSelector('.settings-menu')

    // Verify voice selector exists
    const voiceSelect = page.locator('#voice-select')
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

    // Close settings
    await page.locator('.close-settings').click()
  })

  test('should persist Web Speech model selection across page refresh', async ({ page }) => {
    // Capture console logs
    const logs: string[] = []
    page.on('console', (msg) => {
      logs.push(msg.text())
    })

    // Mock Web Speech API
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        console.log('SPEECH_STARTED:', utterance.text.substring(0, 50))
        setTimeout(() => utterance.onstart?.({} as any), 10)
        setTimeout(() => utterance.onend?.({} as any), 100)
      }
      window.speechSynthesis.cancel = () => console.log('SPEECH_CANCELLED')
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Open settings and select Web Speech
    const settingsBtn = page.locator('button[aria-label="Settings"]')
    await settingsBtn.click()
    await page.waitForSelector('.settings-menu')

    const modelSelect = page.locator('#model-select')
    await modelSelect.selectOption('web_speech')
    await expect(modelSelect).toHaveValue('web_speech')

    // Close settings
    await page.locator('.close-settings').click()
    await page.waitForTimeout(500)

    // Go back to home
    const backBtn = page.locator('button:has-text("← Back")')
    await backBtn.click()
    await page.waitForSelector('text=Short Test Book', { timeout: 5000 })

    // Clear logs before re-opening to only check logs from this point
    logs.length = 0

    // Re-open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Open settings and verify Web Speech is still selected
    await settingsBtn.click()
    await page.waitForSelector('.settings-menu')

    const modelSelectAfterReload = page.locator('#model-select')
    await expect(modelSelectAfterReload).toHaveValue('web_speech')

    // Close settings
    await page.locator('.close-settings').click()
    await page.waitForTimeout(500)

    // Click a segment - should use Web Speech
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()
    await page.waitForTimeout(2000)

    // Verify Web Speech was used (not Kokoro)
    expect(logs.some((log: string) => log.includes('SPEECH_STARTED'))).toBe(true)
    expect(logs.some((log: string) => log.includes('KokoroClient'))).toBe(false)
  })

  test('should open reader and load segments immediately', async ({ page }) => {
    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    const readButton = page.locator('button:has-text("Read")').first()
    await expect(readButton).toBeEnabled({ timeout: 5000 })
    await readButton.click()

    // Verify reader opened
    await page.waitForSelector('.reader-page', { timeout: 5000 })

    // Verify segments loaded
    const segments = page.locator('.segment')
    await expect(segments.first()).toBeVisible({ timeout: 5000 })

    const segmentCount = await segments.count()
    expect(segmentCount).toBeGreaterThan(0)
  })

  test('should use Web Speech model and play immediately on segment click', async ({ page }) => {
    // Select Web Speech model
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('web_speech')
    await expect(modelSelect).toHaveValue('web_speech')

    // Mock Web Speech API
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        console.log('SPEECH_STARTED:', utterance.text.substring(0, 50))
        setTimeout(() => utterance.onstart?.({} as any), 10)
        setTimeout(() => utterance.onend?.({} as any), 100)
      }
      window.speechSynthesis.cancel = () => console.log('SPEECH_CANCELLED')
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Wait for segments to load
    await page.waitForSelector('.segment', { timeout: 5000 })

    // Open settings and select Web Speech
    const settingsBtn = page.locator('button[aria-label="Settings"]')
    await settingsBtn.click()
    await page.waitForSelector('.settings-menu')

    const settingsModelSelect = page.locator('#model-select')
    await settingsModelSelect.selectOption('web_speech')

    // Close settings
    await page.locator('.close-settings').click()
    await page.waitForTimeout(500)

    // Click first segment
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Verify playback started
    await page.waitForTimeout(200)
    const playPauseBtn = page.locator('.control-btn.play-pause')
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause', { timeout: 2000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/)
  })

  test('should use Kokoro model and generate audio on demand', async ({ page }) => {
    test.setTimeout(120000) // 2 minutes for TTS generation

    // Select Kokoro model
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('kokoro')
    await expect(modelSelect).toHaveValue('kokoro')

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Click first segment to trigger generation
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Verify generation started (loading indicator or generating state)
    const generatingIndicator = page.locator('.generating, .loading, [data-generating="true"]')
    if ((await generatingIndicator.count()) > 0) {
      await expect(generatingIndicator.first()).toBeVisible({ timeout: 2000 })
    }

    // Wait for audio to be generated and playback to start
    const playPauseBtn = page.locator('.control-btn.play-pause')
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause', { timeout: 60000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })
  })

  test('should use Piper model and generate audio on demand', async ({ page }) => {
    test.setTimeout(120000) // 2 minutes for TTS generation

    // Select Piper model
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('piper')
    await expect(modelSelect).toHaveValue('piper')

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Click first segment to trigger generation
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Wait for audio generation and playback
    const playPauseBtn = page.locator('.control-btn.play-pause')
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause', { timeout: 60000 })

    // Verify segment is highlighted
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 5000 })
  })

  test('should progress to next segment automatically', async ({ page }) => {
    // Use Web Speech for faster testing
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('web_speech')

    // Mock Web Speech with auto-progression
    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        console.log('SPEECH_SEGMENT:', utterance.text.substring(0, 30))
        setTimeout(() => utterance.onstart?.({} as any), 10)
        setTimeout(() => utterance.onend?.({} as any), 500) // End after 500ms
      }
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Start playback from first segment
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Wait for first segment to be active
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 2000 })

    // Wait for progression to second segment
    const secondSegment = page.locator('.segment').nth(1)
    await expect(secondSegment).toHaveClass(/active|playing/, { timeout: 3000 })
  })

  test('should handle clicking different segments while playing', async ({ page }) => {
    // Use Web Speech for faster testing
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('web_speech')

    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as any), 10)
      }
      window.speechSynthesis.cancel = () => console.log('CANCELLED')
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Click first segment
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()
    await expect(firstSegment).toHaveClass(/active|playing/, { timeout: 2000 })

    // Click third segment while first is playing
    const thirdSegment = page.locator('.segment').nth(2)
    await thirdSegment.click()

    // Verify third segment is now active
    await expect(thirdSegment).toHaveClass(/active|playing/, { timeout: 2000 })

    // Verify first segment is no longer active
    await expect(firstSegment).not.toHaveClass(/active|playing/)
  })

  test('should persist playback position on pause/resume', async ({ page }) => {
    // Use Web Speech
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('web_speech')

    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as any), 10)
      }
      window.speechSynthesis.cancel = () => {}
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Start playback
    const secondSegment = page.locator('.segment').nth(1)
    await secondSegment.click()
    await expect(secondSegment).toHaveClass(/active|playing/, { timeout: 2000 })

    // Pause
    const playPauseBtn = page.locator('.control-btn.play-pause')
    await playPauseBtn.click()
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Play', { timeout: 1000 })

    // Verify segment is still highlighted (paused state)
    await expect(secondSegment).toHaveClass(/active|paused/)

    // Resume
    await playPauseBtn.click()
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause', { timeout: 1000 })

    // Verify same segment is still active
    await expect(secondSegment).toHaveClass(/active|playing/)
  })

  test('should show error state when generation fails', async ({ page }) => {
    // Select Kokoro model
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('kokoro')

    // Mock generation failure
    await page.route('**/*', (route) => {
      if (route.request().url().includes('onnx') || route.request().url().includes('model')) {
        route.abort()
      } else {
        route.continue()
      }
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Click segment to trigger generation
    const firstSegment = page.locator('.segment').first()
    await firstSegment.click()

    // Verify error indicator appears
    const errorIndicator = page.locator('.error, .failed, [data-error="true"]')
    await expect(errorIndicator.first()).toBeVisible({ timeout: 10000 })
  })

  test('should load reader quickly (< 2 seconds)', async ({ page }) => {
    const startTime = Date.now()

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()

    // Wait for reader to be fully loaded
    await page.waitForSelector('.reader-page')
    await page.locator('.segment').first().waitFor({ state: 'visible' })

    const loadTime = Date.now() - startTime
    expect(loadTime).toBeLessThan(2000) // Should load in under 2 seconds
  })

  test('should handle rapid segment clicks without breaking', async ({ page }) => {
    // Use Web Speech
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /Model|TTS/ })
      .first()
    await modelSelect.selectOption('web_speech')

    await page.evaluate(() => {
      window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
        setTimeout(() => utterance.onstart?.({} as any), 10)
      }
      window.speechSynthesis.cancel = () => {}
    })

    // Open reader
    await page.locator('button:has-text("Deselect all")').click()
    await page.locator('input[type="checkbox"]').first().check()
    await page.locator('button:has-text("Read")').first().click()
    await page.waitForSelector('.reader-page')

    // Rapidly click multiple segments
    const segments = page.locator('.segment')
    for (let i = 0; i < 5; i++) {
      await segments.nth(i).click({ delay: 50 })
    }

    // Verify last clicked segment is active
    await expect(segments.nth(4)).toHaveClass(/active|playing/, { timeout: 2000 })

    // Verify playback is still functional
    const playPauseBtn = page.locator('.control-btn.play-pause')
    await expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause')
  })
})
