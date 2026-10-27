import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import JSZip from 'jszip'

import { clearAppStorage, exportAs, importAndOpen, generateAudiobook } from './helpers/flows'

const CONAN_DOYLE_EPUB = join(
  process.cwd(),
  'books',
  'arthur-conan-doyle_the-sign-of-the-four_advanced.epub'
)

/**
 * Full-book processing E2E test suite.
 *
 * Uploads "The Sign of the Four" by Arthur Conan Doyle, generates audio for
 * ALL chapters, then exports to every available format and validates the output.
 *
 * This is intentionally a long-running stress test — it exercises the entire
 * pipeline end-to-end with a real, complete book.
 */
test.describe('Full Book Processing — Conan Doyle', () => {
  // 30 minutes for the entire suite
  test.describe.configure({ timeout: 1800000 })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await clearAppStorage(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
    page.on('console', (msg) => {
      console.log('[PAGE ' + msg.type() + '] ' + msg.text())
    })
  })

  test('should upload and parse the full Conan Doyle EPUB', async ({ page }) => {
    test.setTimeout(60000)

    const epubBuffer = await readFile(CONAN_DOYLE_EPUB)
    await importAndOpen(
      page,
      {
        name: 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
        mimeType: 'application/epub+zip',
        buffer: epubBuffer,
      },
      /Sign of the Four/i
    )

    // Verify author in the library overlay
    await page.locator('button[aria-label="Books"]').click()
    await expect(page.getByText(/Arthur Conan Doyle/i)).toBeVisible()

    // Verify chapter count — the book has 12 chapters
    await page.locator('section[aria-label="Books"] button[aria-label="Close"]').click()
    await page.locator('button[aria-label="Table of contents"]').click()
    const chapterRows = page.locator('.toc-item')
    const count = await chapterRows.count()
    expect(count).toBeGreaterThanOrEqual(12)
  })

  test('should generate all chapters and export to all formats', async ({ page }) => {
    // 25 minutes for full book generation + exports
    test.setTimeout(1500000)

    // --- Upload ---
    const epubBuffer = await readFile(CONAN_DOYLE_EPUB)
    await importAndOpen(
      page,
      {
        name: 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
        mimeType: 'application/epub+zip',
        buffer: epubBuffer,
      },
      /Sign of the Four/i
    )

    // --- Verify chapters ---
    await page.locator('button[aria-label="Table of contents"]').click()
    const chapterCount = await page.locator('.toc-item').count()
    expect(chapterCount).toBeGreaterThanOrEqual(12)
    await page.locator('button[aria-label="Close"]:visible').first().click()

    // --- Generate audio for all chapters ---
    await generateAudiobook(page)

    // Wait for generation to start
    await expect(page.locator('.prep')).toBeVisible({ timeout: 60000 })

    // Wait for generation to finish — every segment of the book is generated
    await expect
      .poll(async () => page.locator('.segment-generated').count(), {
        timeout: 1200000,
        intervals: [5000],
      })
      .toBe(await page.locator('.segment').count())

    // --- Export to each format and validate ---

    // 1. Export MP3
    const mp3Download = (await exportAs(page, 'mp3')).download
    const mp3Name = mp3Download.suggestedFilename()
    expect(mp3Name.toLowerCase()).toContain('.mp3')
    const mp3Path = join(process.cwd(), 'test-results', 'full-book-export.mp3')
    await mp3Download.saveAs(mp3Path)
    const mp3Buf = await readFile(mp3Path)
    expect(mp3Buf.length).toBeGreaterThan(100000)
    // MP3 starts with ID3 tag or sync word
    const mp3Header = mp3Buf.slice(0, 3).toString('ascii')
    const isValidMp3 = mp3Header === 'ID3' || (mp3Buf[0] === 0xff && (mp3Buf[1] & 0xe0) === 0xe0)
    expect(isValidMp3).toBeTruthy()
    console.log('[Export MP3] size=' + mp3Buf.length + ' file=' + mp3Name)

    // 2. Export M4B
    const m4bDownload = (await exportAs(page, 'm4b')).download
    const m4bName = m4bDownload.suggestedFilename()
    expect(m4bName.toLowerCase()).toContain('.m4b')
    const m4bPath = join(process.cwd(), 'test-results', 'full-book-export.m4b')
    await m4bDownload.saveAs(m4bPath)
    const m4bBuf = await readFile(m4bPath)
    expect(m4bBuf.length).toBeGreaterThan(100000)
    // M4B/MP4 container — ftyp box at offset 4
    const m4bFtyp = m4bBuf.slice(4, 8).toString('ascii')
    expect(['ftyp', 'moov', 'mdat', 'free']).toContain(m4bFtyp)
    console.log('[Export M4B] size=' + m4bBuf.length + ' file=' + m4bName)

    // 3. Export WAV
    const wavDownload = (await exportAs(page, 'wav')).download
    const wavName = wavDownload.suggestedFilename()
    expect(wavName.toLowerCase()).toContain('.wav')
    const wavPath = join(process.cwd(), 'test-results', 'full-book-export.wav')
    await wavDownload.saveAs(wavPath)
    const wavBuf = await readFile(wavPath)
    expect(wavBuf.length).toBeGreaterThan(100000)
    expect(wavBuf.slice(0, 4).toString('ascii')).toBe('RIFF')
    expect(wavBuf.slice(8, 12).toString('ascii')).toBe('WAVE')
    console.log('[Export WAV] size=' + wavBuf.length + ' file=' + wavName)

    // 4. Export MP4
    const mp4Download = (await exportAs(page, 'mp4')).download
    const mp4Name = mp4Download.suggestedFilename()
    expect(mp4Name.toLowerCase()).toContain('.mp4')
    const mp4Path = join(process.cwd(), 'test-results', 'full-book-export.mp4')
    await mp4Download.saveAs(mp4Path)
    const mp4Buf = await readFile(mp4Path)
    expect(mp4Buf.length).toBeGreaterThan(100000)
    const mp4Ftyp = mp4Buf.slice(4, 8).toString('ascii')
    expect(['ftyp', 'moov', 'mdat', 'free']).toContain(mp4Ftyp)
    console.log('[E MP4] size=' + mp4Buf.length + ' file=' + mp4Name)

    // 5. Export EPUB (with media overlays) — most thorough validation
    const epubDownload = (await exportAs(page, 'epub')).download
    const epubName = epubDownload.suggestedFilename()
    expect(epubName.toLowerCase()).toContain('.epub')
    const epubPath = join(process.cwd(), 'test-results', 'full-book-export.epub')
    await epubDownload.saveAs(epubPath)
    const epubBuf = await readFile(epubPath)
    expect(epubBuf.length).toBeGreaterThan(10000)
    console.log('[Export EPUB] size=' + epubBuf.length + ' file=' + epubName)

    // --- Deep EPUB validation ---
    const zip = await JSZip.loadAsync(epubBuf)

    // Mimetype
    const mimetype = await zip.file('mimetype')?.async('string')
    expect(mimetype).toBe('application/epub+zip')

    // Container
    const container = zip.file('META-INF/container.xml')
    expect(container).toBeTruthy()

    // OPF
    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    expect(opf).toBeTruthy()

    // Chapter XHTML files (excluding nav)
    const chapterXhtmlFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/') && f.endsWith('.xhtml') && f !== 'OEBPS/nav.xhtml'
    )
    console.log('[EPUB] chapter XHTML files: ' + chapterXhtmlFiles.length)
    expect(chapterXhtmlFiles.length).toBeGreaterThanOrEqual(12)

    // Audio files — each chapter with generated audio should have an MP3
    const audioFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/audio/') && f.endsWith('.mp3')
    )
    console.log('[EPUB] audio ' + audioFiles.length)
    expect(audioFiles.length).toBeGreaterThan(0)

    // Validate audio files are non-empty
    for (const audioPath of audioFiles) {
      const audioData = await zip.file(audioPath)?.async('uint8array')
      expect(audioData).toBeTruthy()
      expect(audioData!.length).toBeGreaterThan(1000)
    }

    // SMIL files — one per chapter with audio
    const smilFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/smil/') && f.endsWith('.smil')
    )
    console.log('[EPUB] SMIL files: ' + smilFiles.length)
    expect(smilFiles.length).toBe(audioFiles.length)

    // Validate SMIL content
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)?.async('string')
      expect(smilContent).toBeTruthy()
      expect(smilContent).toContain('audio src=')
      expect(smilContent).toContain('text src=')
      expect(smilContent).toContain('clipBegin=')
      expect(smilContent).toContain('clipEnd=')
    }

    // Validate chapter XHTML content (spot-check first 3)
    for (const xhtmlPath of chapterXhtmlFiles.slice(0, 3)) {
      const content = await zip.file(xhtmlPath)?.async('string')
      expect(content).toBeTruthy()
      expect(content!.length).toBeGreaterThan(100)
      expect(content).toContain('<?xml')
      expect(content).toContain('xmlns')
    }

    // OPF manifest should reference XHTML, audio, and SMIL
    expect(opf).toContain('media-type="application/xhtml+xml"')
    if (audioFiles.length > 0) {
      expect(opf).toContain('media-type="audio/mpeg"')
      expect(opf).toContain('media-type="application/smil+xml"')
      expect(opf).toContain('media-overlay=')
    }

    // Navigation document
    const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
    expect(nav).toBeTruthy()
    expect(nav).toContain('epub:type="toc"')

    // NCX (backward compat)
    const ncx = await zip.file('OEBPS/toc.ncx')?.async('string')
    expect(ncx).toBeTruthy()
    expect(ncx).toContain('navPoint')
  })
})
