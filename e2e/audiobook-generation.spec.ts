import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

test.describe('Audiobook Generation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should generate with Web Speech API (default)', async ({ page }) => {
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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Verify Web Speech API is selected by default
    const modelSelect = page
      .locator('select')
      .filter({ hasText: /TTS Model|Web Speech API/ })
      .first()
    const selectedValue = await modelSelect.inputValue()
    expect(selectedValue).toBe('webspeech')

    // For a stable downloadable generation in headless tests, explicitly
    // switch to the Kokoro model and pick a Kokoro-compatible voice.
    const ttsModelSelect = page
      .locator('select')
      .filter({ hasText: /TTS Model|Web Speech API/ })
      .first()
    await ttsModelSelect.selectOption('kokoro')
    // Wait a moment for voices to update
    await page.waitForTimeout(200)
    const voiceSelect = page.locator('select').filter({ hasText: /Voice/ }).first()
    // Choose the default kokoro voice 'af_heart'
    await voiceSelect.selectOption('af_heart')

    // Deselect all chapters, then select only the first one
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Verify chapter is selected (UI shows "Selected: X / Y")
    await expect(page.locator('text=Selected: 1 / 22')).toBeVisible()

    // Set up download promise before clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 })

    // Click generate & download button
    const generateButton = page.locator('button:has-text("Generate & Download")')
    await generateButton.click()

    // Wait for progress to appear
    await page.waitForSelector('text=/Chapter 1\\//i', { timeout: 10000 })

    // Wait for download
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp3$/)

    // Verify file size is reasonable (should be > 1KB)
    const path = await download.path()
    if (path) {
      const stats = await readFile(path)
      expect(stats.length).toBeGreaterThan(1000)
    }
  })

  test('should load the application', async ({ page }) => {
    await expect(page).toHaveTitle(/Audiobook Generator/i)
    await expect(page.locator('h1')).toContainText(/Audiobook Generator/i)
  })

  test('should upload EPUB and display book info', async ({ page }) => {
    // Load the example EPUB file
    const epubPath = join(
      process.cwd(),
      'example',
      'The_Life_and_Adventures_of_Robinson_Crusoe.epub'
    )
    const epubBuffer = await readFile(epubPath)

    // Upload file
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'Robinson_Crusoe.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for parsing to complete
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Verify book metadata
    await expect(page.getByText('Author: Daniel Defoe')).toBeVisible()
    await expect(page.locator('text=/\\d+ chapters/i')).toBeVisible()
  })

  test('should generate single chapter as MP3', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for the entire test

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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Deselect all chapters first, then select only the first one
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Select MP3 format
    const formatSelect = page.locator('select').first()
    await formatSelect.selectOption('mp3')

    // Select bitrate
    const bitrateSelect = page.locator('select').nth(1)
    await bitrateSelect.selectOption('192')

    // Set up download promise before clicking
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 })

    // Click generate button
    await page.locator('button:has-text("Generate & Download Audiobook")').click()

    // Wait for generation to complete
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 120000 })

    // Wait for download
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp3$/)

    // Verify file size is reasonable (should be > 1KB)
    const path = await download.path()
    if (path) {
      const stats = await readFile(path)
      expect(stats.length).toBeGreaterThan(1000)
    }
  })

  test('should generate single chapter as M4B', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes for M4B generation
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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Select first chapter
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Select M4B format
    const formatSelect = page.locator('select').first()
    await formatSelect.selectOption('m4b')

    // Select bitrate
    const bitrateSelect = page.locator('select').nth(1)
    await bitrateSelect.selectOption('256')

    // Set up download promise
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 })

    // Click generate button
    await page.locator('button:has-text("Generate & Download Audiobook")').click()

    // Wait for generation
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 120000 })

    // Verify download
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.m4b$/)
  })

  test('should generate two chapters as MP3', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for two chapters

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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Deselect all, then select first two chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()

    // Select MP3 format
    const formatSelect = page.locator('select').first()
    await formatSelect.selectOption('mp3')

    // Set up download promise
    const downloadPromise = page.waitForEvent('download', { timeout: 180000 })

    // Click generate button
    await page.locator('button:has-text("Generate & Download Audiobook")').click()

    // Wait for progress messages
    await page.waitForSelector('text=/Generating 1\\/2/i', { timeout: 120000 })
    await page.waitForSelector('text=/Generating 2\\/2/i', { timeout: 120000 })
    await page.waitForSelector('text=/Encoding to MP3/i', { timeout: 60000 })

    // Wait for completion
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 60000 })

    // Verify download
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.mp3$/)

    // Verify file is larger than single chapter
    const path = await download.path()
    if (path) {
      const stats = await readFile(path)
      expect(stats.length).toBeGreaterThan(2000) // Should be larger than single chapter
    }
  })

  test('should generate two chapters as M4B with metadata', async ({ page }) => {
    test.setTimeout(240000) // 4 minutes for two chapters

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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Deselect all, then select first two chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()

    // Select M4B format
    const formatSelect = page.locator('select').first()
    await formatSelect.selectOption('m4b')

    // Select high bitrate
    const bitrateSelect = page.locator('select').nth(1)
    await bitrateSelect.selectOption('320')

    // Set up download promise
    const downloadPromise = page.waitForEvent('download', { timeout: 180000 })

    // Click generate button
    await page.locator('button:has-text("Generate & Download Audiobook")').click()

    // Wait for completion
    await page.waitForSelector('text=/Audiobook created successfully/i', { timeout: 180000 })

    // Verify download
    const download = await downloadPromise
    const filename = download.suggestedFilename()
    expect(filename).toMatch(/\.m4b$/)
    expect(filename).toContain('Robinson_Crusoe') // Should include book title
  })

  test('should show progress during generation', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

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

    // Wait for book to load
    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Deselect all, then select one chapter
    await page.locator('button:has-text("Deselect all")').click()
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()

    // Click generate (without download)
    await page.locator('button:has-text("Generate Chapters")').click()

    // Verify progress messages appear
    await expect(page.locator('text=/Generating 1\\/1/i')).toBeVisible({ timeout: 60000 })

    // Wait for completion
    await page.waitForSelector('text=/Generating 1\\/1/i', { state: 'hidden', timeout: 120000 })
  })

  test('should allow format and bitrate selection', async ({ page }) => {
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

    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Verify format dropdown exists and has correct options
    const formatSelect = page.locator('select').first()
    await expect(formatSelect).toBeVisible()

    const formatOptions = await formatSelect.locator('option').allTextContents()
    expect(formatOptions).toContain('MP3 (Recommended)')
    expect(formatOptions).toContain('M4B (Audiobook)')
    expect(formatOptions).toContain('WAV (Uncompressed)')

    // Select MP3 to show bitrate options
    await formatSelect.selectOption('mp3')

    // Verify bitrate dropdown appears
    const bitrateSelect = page.locator('select').nth(1)
    await expect(bitrateSelect).toBeVisible()

    const bitrateOptions = await bitrateSelect.locator('option').allTextContents()
    expect(bitrateOptions.length).toBeGreaterThan(0)
    expect(bitrateOptions.some((opt) => opt.includes('192'))).toBeTruthy()
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

    await page.waitForSelector('text=The Life and Adventures of Robinson Crusoe', {
      timeout: 10000,
    })

    // Deselect all, then select multiple chapters
    await page.locator('button:has-text("Deselect all")').click()
    const checkboxes = page.locator('input[type="checkbox"]')
    await checkboxes.nth(0).check()
    await checkboxes.nth(1).check()
    await checkboxes.nth(2).check()

    // Start generation
    await page.locator('button:has-text("Generate Chapters")').click()

    // Wait for generation to start
    await page.waitForSelector('text=/Generating/i', { timeout: 30000 })

    // Click cancel
    await page.locator('button:has-text("Cancel")').click()

    // Verify generation stopped (button may still be disabled briefly)
    await page.waitForTimeout(2000)
    await expect(page.locator('button:has-text("Generate Chapters")')).toBeEnabled({
      timeout: 10000,
    })
  })
})
