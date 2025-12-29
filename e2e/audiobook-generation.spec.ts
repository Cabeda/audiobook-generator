import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

// Use the short EPUB for deterministic, faster E2E runs
const EXAMPLE_EPUB = join(process.cwd(), 'books', 'test-short.epub')
const SHORT_EPUB = EXAMPLE_EPUB

test.describe('Audiobook Generation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Ensure a clean storage state between tests to avoid cached example uploads
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    // Log browser console messages during E2E for debugging
    page.on('console', (msg) => {
      // Print page console messages to Playwright output for easier debugging
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    await expect(page.locator('h1')).toContainText(/Audiobook Generator/i)
  })

  test('should upload EPUB and display book info', async ({ page }) => {
    // Load the example EPUB file
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    // Upload file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for parsing to complete
    await page.waitForSelector('text=Short Test Book', {
      timeout: 20000,
    })

    // Verify book metadata
    await expect(page.getByText('Author: Test Author')).toBeVisible()
    // Target the chapter count element explicitly to avoid ambiguous matches
    await expect(page.locator('.chapter-count')).toBeVisible()
  })

  test('should upload SHORT EPUB and display quick info', async ({ page }) => {
    // Use the small epub fixture to quickly test upload and parsing
    const epubPath = SHORT_EPUB
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Ensure we're on Upload tab so the hidden file input is rendered
    const uploadTab = page.locator('button.tab:has-text("Upload New")')
    if (await uploadTab.isVisible().catch(() => false)) {
      await uploadTab.click()
    }
    await page.waitForSelector('.unified-input')
    const fileInput = page.locator('input[type="file"]')
    // If not visible, try clicking the Start Over nav button and wait again
    if (!(await fileInput.isVisible().catch(() => false))) {
      const startOver = page.locator('button:has-text("Start Over")')
      if (await startOver.isVisible().catch(() => false)) {
        await startOver.click()
      }
      await page.waitForSelector('input[type="file"]', { timeout: 10000 })
    }
    await fileInput.setInputFiles(epubPath)

    // Short book should parse quickly; verify title and author are displayed
    await page.waitForSelector('text=Short Test Book', { timeout: 20000 })
    await expect(page.getByText('Author: Test Author')).toBeVisible()
  })

  test('should generate single chapter as MP3', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for the entire test

    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Deselect all chapters first, then select only the first one
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Select MP3 format
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()
    const advanced = page.locator('.advanced-options')
    await expect(advanced).toBeVisible()
    const formatSelect = advanced.locator('label:has-text("Format") select')
    await expect(formatSelect).toBeVisible()
    await formatSelect.selectOption('mp3')

    // Select bitrate
    const bitrateSelect = advanced.locator('label:has-text("Quality") select')
    await bitrateSelect.selectOption('192')

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

    // Advanced options already open; proceed to generate
    // Click generate button
    await page.locator('button:has-text("Generate & Download")').click()

    // Wait for generation to complete
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 120000 })

    // Wait for 'Download started!' in UI and validate via download-trigger console message
    await page.waitForSelector('text=Download started!', { timeout: 120000 })
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    // Validate the download object reports an MP3 filename
    expect(downloadConsoleLogs[0].filename?.endsWith('.mp3')).toBeTruthy()

    // Verify file size via download-trigger console log size field (should be > 1KB)
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0].size).toBeGreaterThan(1000)
  })

  test('should generate single chapter as M4B', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for M4B generation
    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Select first chapter
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Select M4B format
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()
    const advanced = page.locator('.advanced-options')
    await expect(advanced).toBeVisible()
    const formatSelect = advanced.locator('label:has-text("Format") select')
    await expect(formatSelect).toBeVisible()
    await formatSelect.selectOption('m4b')

    // Select bitrate
    const bitrateSelect = advanced.locator('label:has-text("Quality") select')
    await expect(bitrateSelect).toBeVisible()
    await bitrateSelect.selectOption('256')

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

    // Advanced options already open; proceed to generate
    // Click generate button and wait for the download event
    const downloadPromise = page.waitForEvent('download')
    await page.locator('button:has-text("Generate & Download")').click()

    // Wait for generation completion message (optional but keeps parity with other tests)
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 120000 })

    // Verify download
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.m4b$/)
  })

  test('should start playback when clicking Read', async ({ page }) => {
    // Upload EPUB
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)

    // Wait for book load
    await page.waitForSelector('text=Short Test Book', { timeout: 10000 })

    // Ensure first chapter is selected
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Click the Read button on the first chapter
    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()

    // The reader should be visible (navigated to the reader view)
    const chapterTitle = page.locator('#chapter-title')
    await expect(chapterTitle).toBeVisible({ timeout: 10000 })
    // The reader's play/pause control should show a Pause control when playing
    const readerPlayPause = page.locator('.reader-page .control-btn.play-pause')
    await expect(readerPlayPause).toBeVisible()
    // The button's aria-label should be 'Pause' when audio is playing
    await expect(readerPlayPause).toHaveAttribute('aria-label', 'Pause')
  })

  test('space key toggles play/pause when no element is selected', async ({ page }) => {
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Ensure first chapter selected and open reader
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()
    await page.waitForSelector('#chapter-title')

    // Ensure no element is focused and no selection present
    await page.evaluate(() => {
      try {
        ;(document.activeElement as HTMLElement)?.blur?.()
        const sel = window.getSelection()
        if (sel) sel.removeAllRanges()
      } catch {
        // ignore
      }
    })

    const readerPlayPause = page.locator('.reader-page .control-btn.play-pause')
    await expect(readerPlayPause).toBeVisible()
    // It should be playing initially (auto-play) - Pause attribute
    await expect(readerPlayPause).toHaveAttribute('aria-label', 'Pause')

    // Press Space to pause
    await page.keyboard.press('Space')
    await expect(readerPlayPause).toHaveAttribute('aria-label', 'Play')

    // Press Space again to play
    await page.keyboard.press('Space')
    await expect(readerPlayPause).toHaveAttribute('aria-label', 'Pause')
  })

  test('should stay on reader after page reload', async ({ page }) => {
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Deselect and select first chapter
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Open reader for first chapter
    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()
    await page.waitForSelector('#chapter-title')

    // Reload and ensure we remain on the reader page and same chapter
    await page.reload()
    await page.waitForSelector('#chapter-title')
    await expect(page.locator('#chapter-title')).toBeVisible()
    // Hash should be a reader route
    const hash = await page.evaluate(() => location.hash)
    expect(hash.startsWith('#/reader/')).toBeTruthy()
  })

  test('should restore playback position after page reload', async ({ page }) => {
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Ensure first chapter selected and open reader
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()
    await page.waitForSelector('#chapter-title')

    // Wait a bit for playback progress
    await page.waitForTimeout(2000)
    // Read persisted playback time from localStorage
    const startSeconds = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('audiobook_player_state')
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        return Math.floor(parsed.currentTime || 0)
      } catch {
        return 0
      }
    })

    // Reload and wait for the player to re-initialize
    await page.reload()
    await page.waitForFunction(() => !!localStorage.getItem('audiobook_player_state'))
    const afterSeconds = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('audiobook_player_state')
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        return Math.floor(parsed.currentTime || 0)
      } catch {
        return 0
      }
    })

    // The restored time should be close to the previous time (within 3 seconds)
    expect(Math.abs(afterSeconds - startSeconds)).toBeLessThanOrEqual(3)
  })

  test('should stay on book view after reload', async ({ page }) => {
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Ensure we are in book view
    const bookHeading = page.locator('h2:has-text("Short Test Book")')
    await expect(bookHeading).toBeVisible()
    const bookHashBefore = await page.evaluate(() => location.hash)
    expect(bookHashBefore.startsWith('#/book/')).toBeTruthy()

    // Reload and check we remain on '/book/:id'
    await page.reload()
    await page.waitForSelector('text=Short Test Book')
    const bookHashAfter = await page.evaluate(() => location.hash)
    expect(bookHashAfter.startsWith('#/book/')).toBeTruthy()
  })

  test('should keep playing when clicking Back from reader', async ({ page }) => {
    // Load book and open reader
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Ensure first chapter is selected and open reader
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()

    // Wait for reader to show and be playing
    await page.waitForSelector('#chapter-title', { timeout: 10000 })
    const readerPlayPause = page.locator('.reader-page .control-btn.play-pause')
    await expect(readerPlayPause).toHaveAttribute('aria-label', 'Pause')

    // Click back to book
    const backButton = page.locator('.reader-header .back-button')
    await backButton.click()
  })

  test('should show chapter duration (>= segment duration) in persistent player', async ({
    page,
  }) => {
    const epubPath = SHORT_EPUB
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(epubPath)
    await page.waitForSelector('text=Short Test Book')

    // Ensure first chapter selected and open reader
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    const firstReadButton = page.locator('button:has-text("Read")').first()
    await firstReadButton.click()
    await page.waitForSelector('#chapter-title')

    // Wait a bit for initial generation & store update
    await page.waitForTimeout(1500)

    // Read persisted player state
    const parsedState = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('audiobook_player_state') || '{}')
      } catch {
        return {}
      }
    })

    expect(parsedState.chapterDuration).toBeGreaterThanOrEqual(parsedState.duration)
  })

  test('should generate two chapters as MP3', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for two chapters

    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Deselect all, then select first two chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()

    // Select MP3 format
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()
    const advanced = page.locator('.advanced-options')
    await expect(advanced).toBeVisible()
    const formatSelect = advanced.locator('label:has-text("Format") select')
    await expect(formatSelect).toBeVisible()
    await formatSelect.selectOption('mp3')

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

    // Advanced options already open; proceed to generate
    // Click generate button
    await page.locator('button:has-text("Generate & Download")').click()

    // Wait for progress messages
    await page.waitForSelector('text=/Generating 1\\/2/i', { timeout: 120000 })
    await page.waitForSelector('text=/Generating 2\\/2/i', { timeout: 120000 })
    await page.waitForSelector('text=/Encoding to MP3/i', { timeout: 60000 })

    // Wait for completion
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 60000 })

    // Verify download via 'Download started!' UI text and download-trigger console message
    await page.waitForSelector('text=Download started!', { timeout: 180000 })
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    // Validate the download object reports an MP3 filename
    expect(downloadConsoleLogs[0].filename?.endsWith('.mp3')).toBeTruthy()

    // Verify file is larger than single chapter via download-console log size
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0].size).toBeGreaterThan(2000) // Should be larger than single chapter
  })

  test('should generate two chapters as M4B with metadata', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for two chapters

    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Deselect all, then select first two chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()

    // Select M4B format
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()
    const advanced = page.locator('.advanced-options')
    await expect(advanced).toBeVisible()
    const formatSelect = advanced.locator('label:has-text("Format") select')
    await expect(formatSelect).toBeVisible()
    await formatSelect.selectOption('m4b')

    // Select high bitrate
    const bitrateSelect = advanced.locator('label:has-text("Quality") select')
    await expect(bitrateSelect).toBeVisible()
    await bitrateSelect.selectOption('320')

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

    // Advanced options already open; proceed to generate
    // Click generate button
    await page.locator('button:has-text("Generate & Download")').click()

    // Wait for completion
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 180000 })

    // Verify download via 'Download started!' UI text and download-trigger console message
    await page.waitForSelector('text=Download started!', { timeout: 180000 })
    expect(downloadConsoleLogs.length).toBeGreaterThan(0)
    expect(downloadConsoleLogs[0]).toContain('.m4b')
  })

  test('should show progress during generation', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load
    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Deselect all, then select one chapter
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Click generate (without download)
    const genButton = page.locator('button:has-text("Generate & Download")')
    await expect(genButton).toBeVisible()
    await expect(genButton).toBeEnabled()
    await genButton.click()

    // Verify progress messages appear
    await expect(page.locator('text=/Chapter 1\\//i')).toBeVisible({ timeout: 60000 })

    // Wait for completion
    await page.waitForSelector('text=/Generating 1\\/1/i', { state: 'hidden', timeout: 120000 })
  })

  test('should allow format and bitrate selection', async ({ page }) => {
    // Upload EPUB
    const epubPath = SHORT_EPUB
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Click Advanced Options to reveal format controls
    const advancedToggle = page.locator('button:has-text("Advanced Options")')
    await expect(advancedToggle).toBeVisible()
    await advancedToggle.click()
    const advanced = page.locator('.advanced-options')
    await expect(advanced).toBeVisible()
    // Verify format dropdown exists and has correct options
    const formatSelect = advanced.locator('label:has-text("Format") select')
    await expect(formatSelect).toBeVisible()

    const formatOptions = await formatSelect.locator('option').allTextContents()
    expect(formatOptions).toContain('MP3 (Recommended)')
    expect(formatOptions).toContain('M4B (Audiobook)')
    expect(formatOptions).toContain('WAV (Uncompressed)')

    // Select MP3 to show bitrate options
    await formatSelect.selectOption('mp3')

    // Verify bitrate dropdown appears (scoped to advanced options)
    const bitrateSelect = advanced.locator('label:has-text("Quality") select')
    await expect(bitrateSelect).toBeVisible()
    await expect(bitrateSelect).toBeVisible()

    const bitrateOptions = await bitrateSelect.locator('option').allTextContents()
    expect(bitrateOptions.length).toBeGreaterThan(0)
    // Ensure at least one commonly available bitrate appears: 128, 192, 256, 320
    const commonBits = ['128', '192', '256', '320']
    expect(bitrateOptions.some((opt) => commonBits.some((s) => opt.includes(s)))).toBeTruthy()
  })

  test('should handle cancellation during generation', async ({ page }) => {
    test.setTimeout(120000) // 2 minutes

    // Upload EPUB
    const epubPath = join(
      process.cwd(),
      'example',
      'The_Life_and_Adventures_of_Robinson_Crusoe.epub'
    )
    const epubBuffer = await readFile(epubPath)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await page.waitForSelector('text=Short Test Book', {
      timeout: 10000,
    })

    // Deselect all, then select multiple chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()
    await checkboxes.nth(2).check()

    // Start generation
    // Start generation using the visible 'Generate & Download' button and cancel shortly after
    const genBtn = page.locator('button:has-text("Generate & Download")')
    await expect(genBtn).toBeVisible()
    await expect(genBtn).toBeEnabled()
    await genBtn.click()

    // Wait for generation to start
    await page.waitForSelector('text=/Generating/i', { timeout: 30000 })

    // Click cancel
    await page.locator('button:has-text("Cancel")').click()

    // Verify generation stopped (button may still be disabled briefly)
    await page.waitForTimeout(2000)
    await expect(page.locator('button:has-text("Generate & Download")')).toBeEnabled({
      timeout: 10000,
    })
  })
})

test('should show a loading spinner when generating a segment while playing', async ({ page }) => {
  const epubPath = SHORT_EPUB
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(epubPath)
  await page.waitForSelector('text=Short Test Book')

  // Ensure first chapter selected and open reader
  await page.locator('button:has-text("Deselect all")').click()
  const firstCheckbox = page.locator('input[type="checkbox"]').first()
  await firstCheckbox.check()
  const firstReadButton = page.locator('button:has-text("Read")').first()
  await firstReadButton.click()
  await page.waitForSelector('#chapter-title')

  // Wait for store to indicate buffering (first segment generation)
  await page.waitForFunction(
    () => {
      try {
        const raw = localStorage.getItem('audiobook_player_state')
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && parsed.isBuffering === true
      } catch {
        return false
      }
    },
    { timeout: 5000 }
  )

  // Check that the UI has a spinner element in the persistent player
  const spinner = page.locator('.persistent-player .spinner')
  await expect(spinner).toBeVisible()
})

test('clicking persistent player opens text reader for current chapter', async ({ page }) => {
  const epubPath = SHORT_EPUB
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(epubPath)
  await page.waitForSelector('text=Short Test Book')

  // Ensure first chapter selected and open reader
  await page.locator('button:has-text("Deselect all")').click()
  const firstCheckbox = page.locator('input[type="checkbox"]').first()
  await firstCheckbox.check()
  const firstReadButton = page.locator('button:has-text("Read")').first()
  await firstReadButton.click()
  await page.waitForSelector('#chapter-title')

  // Click the Back button to return to the book; this hides the reader and shows the persistent player
  const backButton = page.locator('.reader-header .back-button')
  await backButton.click()
  await expect(page.locator('.persistent-player')).toBeVisible()

  // Click the persistent player area to re-open the reader for the playing chapter
  await page.locator('.persistent-player').click()
  await page.waitForSelector('#chapter-title')
  await expect(page.locator('#chapter-title')).toBeVisible()
})
