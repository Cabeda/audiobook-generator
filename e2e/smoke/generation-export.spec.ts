import { test, expect } from '@playwright/test'
import { join } from 'path'
import process from 'node:process'

import {
  clearAppStorage,
  exportAs,
  importAndOpen,
  openSettingsPanel,
  settingsPanel,
} from '../helpers/flows'

const SHORT_EPUB = join(process.cwd(), 'books', 'test-short.epub')

/** The chapter the test generates: the first one in the reading surface. */
const CHAPTER_SELECTOR = '[data-section="0"]'

/**
 * Generation & Export smoke test.
 *
 * Uses Piper TTS (small model, fast generation) to generate a single
 * short chapter, then exports as each format to verify the full pipeline.
 * First run downloads the voice model (~5MB), subsequent runs use cache.
 */
test.describe('Generation & Export', () => {
  // The tests run one after another: each one starts from a clean browser
  // profile and has to fetch the Piper model, and five downloads at once only
  // slow each other down.
  test.describe.configure({ timeout: 240000, mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    // Boot with Piper: Piper is the small, fast model. Setting it before the
    // first load also keeps the suite from downloading the Kokoro model.
    await page.addInitScript(() => {
      localStorage.setItem('audiobook_model', '"piper"')
    })

    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')

    // Clear all storage to ensure fresh generation (no cached segments)
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Import the book
    await importAndOpen(page, SHORT_EPUB, /Short Test Book/)

    // The model picked before boot is the one in effect
    await openSettingsPanel(page)
    await expect(settingsPanel(page).locator('label.field:has-text("Model") select')).toHaveValue(
      'piper'
    )
    await page.locator('aside.settings button[aria-label="Close"]').click()

    // Generate the first chapter by listening to it
    await page.locator('button[aria-label="Listen to this chapter"]').click()
    await expect(page.locator('.transport')).toBeVisible({ timeout: 200000 })
    await expect
      .poll(async () => page.locator(`${CHAPTER_SELECTOR} .segment-generated`).count(), {
        timeout: 200000,
      })
      .toBe(await page.locator(`${CHAPTER_SELECTOR} .segment`).count())
  })

  test('should generate a chapter and export as MP3', async ({ page }) => {
    const { filename } = await exportAs(page, 'mp3')
    expect(filename).toMatch(/\.mp3$/i)
  })

  test('should export as WAV', async ({ page }) => {
    const { filename } = await exportAs(page, 'wav')
    expect(filename).toMatch(/\.wav$/i)
  })

  test('should export as M4B', async ({ page }) => {
    const { filename } = await exportAs(page, 'm4b')
    expect(filename).toMatch(/\.m4b$/i)
  })

  test('should export valid EPUB with correct structure and media overlays', async ({ page }) => {
    const { download } = await exportAs(page, 'epub')

    // --- EPUB Structure Validation ---
    const fs = await import('fs/promises')
    const JSZip = (await import('jszip')).default
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    const buffer = await fs.readFile(downloadPath!)
    const zip = await JSZip.loadAsync(buffer)

    // Mimetype
    const mimetype = await zip.file('mimetype')?.async('string')
    expect(mimetype).toBe('application/epub+zip')

    // Container
    const container = await zip.file('META-INF/container.xml')?.async('string')
    expect(container).toContain('rootfile')

    // OPF
    const opfFiles = Object.keys(zip.files).filter((f) => f.endsWith('.opf'))
    expect(opfFiles.length).toBeGreaterThanOrEqual(1)
    const opf = await zip.file(opfFiles[0])?.async('string')
    expect(opf).toContain('<manifest')
    expect(opf).toContain('<spine')

    // Content files
    const xhtmlFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith('.xhtml') || f.endsWith('.html')
    )
    expect(xhtmlFiles.length).toBeGreaterThanOrEqual(1)

    // SMIL + audio files exist
    const smilFiles = Object.keys(zip.files).filter((f) => f.endsWith('.smil'))
    expect(smilFiles.length).toBeGreaterThanOrEqual(1)
    const audioFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith('.mp3') || f.endsWith('.wav') || f.endsWith('.m4a')
    )
    expect(audioFiles.length).toBeGreaterThanOrEqual(1)

    // --- Media Overlay Validation ---
    // Verify each SMIL correctly maps text segments to audio clips
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)!.async('string')

      // Extract all <text src="..."/> and <audio src="..." clipBegin="..." clipEnd="..."/>
      const textRefs = [...smilContent.matchAll(/<text\s+src="([^"]+)"/g)]
      const audioRefs = [
        ...smilContent.matchAll(
          /<audio\s+src="([^"]+)"\s+clipBegin="([^"]+)"\s+clipEnd="([^"]+)"/g
        ),
      ]

      // Every par must have both a text and audio reference
      expect(textRefs.length).toBeGreaterThan(0)
      expect(audioRefs.length).toBe(textRefs.length)

      // Resolve the XHTML file referenced by text elements
      const xhtmlSrc = textRefs[0][1].split('#')[0]
      const xhtmlBasename = xhtmlSrc.split('/').pop()!
      const xhtmlFile = Object.keys(zip.files).find((f) => f.endsWith(xhtmlBasename))
      expect(xhtmlFile).toBeTruthy()
      const xhtmlContent = await zip.file(xhtmlFile!)!.async('string')

      // Each text fragment ID must exist in the XHTML
      for (const textRef of textRefs) {
        const fragment = textRef[1].split('#')[1]
        if (fragment) {
          expect(xhtmlContent).toContain(`id="${fragment}"`)
        }
      }

      // Audio file referenced by SMIL must exist in the ZIP
      const audioSrc = audioRefs[0][1]
      const audioBasename = audioSrc.split('/').pop()!
      const audioExists = Object.keys(zip.files).some((f) => f.endsWith(audioBasename))
      expect(audioExists).toBe(true)

      // Clip times must be valid and sequential (no gaps/overlaps)
      let lastClipEnd = 0
      for (const audioRef of audioRefs) {
        const clipBegin = parseFloat(audioRef[2])
        const clipEnd = parseFloat(audioRef[3])
        expect(clipEnd).toBeGreaterThan(clipBegin)
        expect(clipBegin).toBeGreaterThanOrEqual(lastClipEnd - 0.001) // float tolerance
        lastClipEnd = clipEnd
      }
    }
  })

  test('should have SMIL timing match actual MP3 duration', async ({ page }) => {
    const { download } = await exportAs(page, 'epub')

    const fs = await import('fs/promises')
    const JSZip = (await import('jszip')).default
    const buffer = await fs.readFile((await download.path())!)
    const zip = await JSZip.loadAsync(buffer)

    const smilFiles = Object.keys(zip.files).filter((f) => f.endsWith('.smil'))
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)!.async('string')
      const audioRefs = [
        ...smilContent.matchAll(
          /<audio\s+src="([^"]+)"\s+clipBegin="([^"]+)"\s+clipEnd="([^"]+)"/g
        ),
      ]

      // Get last clipEnd = total SMIL duration
      const lastClipEnd = parseFloat(audioRefs[audioRefs.length - 1]?.[3] ?? '0')

      // Estimate MP3 duration from file size (export uses 128kbps CBR)
      const audioSrc = audioRefs[0][1]
      const audioBasename = audioSrc.split('/').pop()!
      const audioFile = Object.keys(zip.files).find((f) => f.endsWith(audioBasename))!
      const audioBuffer = await zip.file(audioFile)!.async('uint8array')
      const mp3Duration = audioBuffer.length / (128000 / 8)

      // SMIL total duration should be within 5% of actual MP3 duration
      if (mp3Duration > 0 && lastClipEnd > 0) {
        const driftRatio = Math.abs(lastClipEnd - mp3Duration) / mp3Duration
        expect(driftRatio).toBeLessThan(0.05)
      }
    }
  })
})
