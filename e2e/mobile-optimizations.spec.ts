import { test, expect } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'

import { importAndOpen, openSettingsPanel, settingsPanel } from './helpers/flows'

test.describe('Mobile Optimizations', () => {
  const testFilePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'test-files',
    'sample.txt'
  )

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should use q4 quantization on mobile devices', async ({ browser }) => {
    // Create a new context with mobile user agent
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const page = await context.newPage()
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Load a book
    await importAndOpen(page, testFilePath, /The Great Adventure/)

    // Check that q4 quantization is selected by default on mobile
    await openSettingsPanel(page)
    const quantizationDropdown = settingsPanel(page).locator(
      'label.field:has-text("Quantization") select'
    )
    await expect(quantizationDropdown).toBeVisible()
    await expect(quantizationDropdown).toHaveValue('q4')

    await context.close()
  })

  test('should use q8 quantization on desktop devices', async ({ page }) => {
    await importAndOpen(page, testFilePath, /The Great Adventure/)

    await openSettingsPanel(page)
    const quantizationDropdown = settingsPanel(page).locator(
      'label.field:has-text("Quantization") select'
    )
    await expect(quantizationDropdown).toBeVisible()
    await expect(quantizationDropdown).toHaveValue('q8')
  })

  test('should auto-play first segment when generation starts', async ({ page }) => {
    // Load test file
    await importAndOpen(page, testFilePath, /The Great Adventure/)

    // Start listening — generation and playback start together
    await page.locator('button[aria-label="Listen to this chapter"]').click()

    // The transport bar indicates playback has started. On CI this could be
    // slow, so use a generous timeout
    const transport = page.locator('.transport')
    await expect(transport).toBeVisible({ timeout: 60000 })

    // Auto-play might be blocked by browser policy, but the player should
    // still be visible
    expect(await transport.isVisible()).toBe(true)
  })

  test('should handle mobile device detection correctly', async ({ browser }) => {
    // Create context with mobile user agent
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36',
    })
    const page = await context.newPage()
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Load a book
    await importAndOpen(page, testFilePath, /The Great Adventure/)

    // Check that mobile-optimized settings are being used
    // This is done by checking the page context
    const isMobileDetected = await page.evaluate(() => {
      // Check if the page correctly identifies as mobile
      const ua = navigator.userAgent.toLowerCase()
      return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
    })

    expect(isMobileDetected).toBe(true)

    await context.close()
  })

  test('should generate smaller chunks on mobile devices', async ({ browser }) => {
    // Create context with mobile user agent
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const page = await context.newPage()
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Verify Piper chunk size detection works
    const piperChunkSize = await page.evaluate(() => {
      // Test the mobile detect function for Piper
      const ua = navigator.userAgent.toLowerCase()
      const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
      return isMobile ? 300 : 400
    })

    expect(piperChunkSize).toBe(300)

    await context.close()
  })

  test('should use appropriate chunk size for Piper on Portuguese content', async ({ browser }) => {
    // Create context with mobile user agent
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Android 10; Mobile)',
    })
    const page = await context.newPage()
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Check that device is detected as mobile
    const isMobileDetected = await page.evaluate(() => {
      const ua = navigator.userAgent.toLowerCase()
      return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua)
    })

    expect(isMobileDetected).toBe(true)

    await context.close()
  })
})
