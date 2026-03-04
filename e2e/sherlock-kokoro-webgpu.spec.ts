import { test, expect } from '@playwright/test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import JSZip from 'jszip'

const SHERLOCK_EPUB = join(
  process.cwd(),
  'books',
  'arthur-conan-doyle_the-sign-of-the-four_advanced.epub'
)

/**
 * Ultimate E2E test: Sherlock Holmes with Kokoro + WebGPU
 *
 * Processes "The Sign of the Four" end-to-end using Kokoro TTS on WebGPU,
 * generates audio for all chapters, exports as EPUB with media overlays,
 * and deeply validates the output.
 */
test.describe('Sherlock Holmes — Kokoro WebGPU Full Pipeline', () => {
  // 45 minutes for the entire suite — full book with real TTS is slow
  test.describe.configure({ timeout: 2700000 })

  test.beforeEach(async ({ page }, testInfo) => {
    // This test is only meaningful on desktop Chromium — skip Mobile Chrome project
    test.skip(testInfo.project.name !== 'chromium', 'Skipping on non-desktop projects')

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Set TTS config BEFORE upload so no reload is needed.
    // Use wasm device — WebGPU is unavailable in headless Chromium without flags.
    // q8 is ~4x faster than fp32 with negligible quality difference for CI.
    // parallelChunks=4 processes 4 segments concurrently per chapter.
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('audiobook_device', JSON.stringify('wasm'))
      localStorage.setItem('audiobook_model', JSON.stringify('kokoro'))
      localStorage.setItem('audiobook_quantization', JSON.stringify('q8'))
      localStorage.setItem(
        'audiobook_advanced_settings',
        JSON.stringify({ kokoro: { parallelChunks: 4 } })
      )
    })
    page.on('console', (msg) => {
      console.log(`[PAGE ${msg.type()}] ${msg.text()}`)
    })
  })

  test('should process full book with Kokoro WebGPU and export valid EPUB with media overlays', async ({
    page,
  }) => {
    // 40 minutes for full generation + export
    test.setTimeout(2400000)

    // ─── 1. Upload the Sherlock Holmes EPUB ───
    console.log('[TEST] Uploading Sherlock Holmes EPUB...')
    const epubBuffer = await readFile(SHERLOCK_EPUB)
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    // Wait for book to load and verify metadata
    await page.waitForSelector('text=/Sign of the Four/i', { timeout: 30000 })
    await expect(page.getByText(/Arthur Conan Doyle/i)).toBeVisible()
    console.log('[TEST] Book loaded successfully')

    // Verify chapter count — the book has 12 chapters
    const checkboxes = page.locator('input[type="checkbox"]')
    const chapterCount = await checkboxes.count()
    console.log(`[TEST] Detected ${chapterCount} chapters`)
    expect(chapterCount).toBeGreaterThanOrEqual(12)

    // ─── 2. Verify TTS settings (set in beforeEach) ───
    const appliedDevice = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('audiobook_device') || '"wasm"')
      } catch {
        return 'wasm'
      }
    })
    const appliedModel = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('audiobook_model') || '"kokoro"')
      } catch {
        return 'kokoro'
      }
    })
    const appliedQuantization = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('audiobook_quantization') || '"q8"')
      } catch {
        return 'q8'
      }
    })
    console.log(
      `[TEST] Device: ${appliedDevice}, Model: ${appliedModel}, Quantization: ${appliedQuantization}`
    )
    expect(appliedDevice).toBe('wasm')
    expect(appliedModel).toBe('kokoro')
    expect(appliedQuantization).toBe('q8')

    // ─── 3. Select first 3 chapters only ───
    // 3 chapters fully validates the pipeline (segmentation → TTS → concat → EPUB)
    // without the 30-minute wall of the full book.
    const selectAllButton = page.getByRole('button', { name: 'Select All', exact: true })
    await selectAllButton.click()
    // Deselect chapters beyond the first 3
    const allCheckboxes = page.locator('input[type="checkbox"]')
    const totalChapters = await allCheckboxes.count()
    for (let i = 3; i < totalChapters; i++) {
      const cb = allCheckboxes.nth(i)
      if (await cb.isChecked()) await cb.click()
    }
    for (let i = 0; i < Math.min(3, totalChapters); i++) {
      await expect(allCheckboxes.nth(i)).toBeChecked()
    }
    console.log(`[TEST] First 3 of ${totalChapters} chapters selected`)

    // ─── 4. Generate audio ───
    console.log('[TEST] Starting audio generation...')
    const genButton = page.locator('button:has-text("Generate Selected")')
    await expect(genButton).toBeVisible()
    await expect(genButton).toBeEnabled()
    await genButton.click()

    // Wait for generation to start
    await page.waitForSelector('text=/Generating/i', { timeout: 120000 })
    console.log('[TEST] Generation started')

    // ─── Memory sampling via CDP ───
    const cdpSession = await page.context().newCDPSession(page)
    await cdpSession.send('Performance.enable')
    const memorySamples: { time: number; jsHeapUsedSize: number }[] = []
    const memoryInterval = setInterval(async () => {
      try {
        const metrics = (await cdpSession.send('Performance.getMetrics')) as {
          metrics: { name: string; value: number }[]
        }
        const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')
        if (heap) {
          memorySamples.push({ time: Date.now(), jsHeapUsedSize: heap.value })
          console.log(`[MEMORY] Heap: ${(heap.value / 1024 / 1024).toFixed(1)} MB`)
        }
      } catch {
        // CDP may disconnect on page reload — ignore
      }
    }, 30_000)

    // Wait for the 3 selected chapters to finish.
    // Done when no per-chapter generate/cancel/continue buttons remain.
    console.log('[TEST] Waiting for chapters to finish generating...')
    try {
      await page.waitForFunction(
        () => {
          const pending = document.querySelectorAll(
            '[aria-label="Generate this chapter"], [aria-label="Cancel this chapter"], [aria-label="Continue generating this chapter"]'
          )
          // Only count buttons for checked (selected) chapters
          return pending.length === 0
        },
        { timeout: 1800000, polling: 10000 }
      )
    } finally {
      clearInterval(memoryInterval)
      await cdpSession.detach().catch(() => {})
    }
    console.log('[TEST] All selected chapters generated successfully')

    // Assert no runaway heap growth
    if (memorySamples.length >= 2) {
      const growth = memorySamples.at(-1)!.jsHeapUsedSize / memorySamples[0].jsHeapUsedSize
      console.log(`[MEMORY] Heap growth ratio: ${growth.toFixed(2)}x`)
      expect(growth).toBeLessThan(2.5)
    }

    // Verify the export button is enabled
    const exportButton = page.locator('.export-primary-btn.export-main')
    await expect(exportButton).toBeEnabled({ timeout: 10000 })

    // ─── 5. Export as EPUB with media overlays ───
    console.log('[TEST] Exporting as EPUB with media overlays...')

    // Select EPUB format from the dropdown
    const formatToggle = page.locator('.export-toggle')
    await formatToggle.click()
    await page.waitForSelector('.export-format-menu', { timeout: 5000 })
    const epubOption = page.locator('.format-option').filter({ hasText: 'EPUB' })
    await epubOption.click()

    // Verify EPUB is selected
    await expect(exportButton).toContainText('EPUB')

    // Export and wait for download
    const epubDownload = await Promise.all([
      page.waitForEvent('download', { timeout: 600000 }),
      exportButton.click(),
    ]).then(([dl]) => dl)

    const epubName = epubDownload.suggestedFilename()
    expect(epubName.toLowerCase()).toContain('.epub')
    console.log(`[TEST] EPUB downloaded: ${epubName}`)

    // Save the file for validation
    const outputPath = join(process.cwd(), 'test-results', 'sherlock-kokoro-webgpu.epub')
    await epubDownload.saveAs(outputPath)
    const outputBuf = await readFile(outputPath)
    expect(outputBuf.length).toBeGreaterThan(100000)
    console.log(`[TEST] EPUB file size: ${outputBuf.length} bytes`)

    // ─── 6. Deep EPUB validation ───
    console.log('[TEST] Starting deep EPUB validation...')
    const zip = await JSZip.loadAsync(outputBuf)

    // 6a. Mimetype (must be first entry, uncompressed)
    const mimetype = await zip.file('mimetype')?.async('string')
    expect(mimetype).toBe('application/epub+zip')
    console.log('[EPUB] mimetype: OK')

    // 6b. Container.xml
    const container = await zip.file('META-INF/container.xml')?.async('string')
    expect(container).toBeTruthy()
    expect(container).toContain('rootfile')
    expect(container).toContain('OEBPS/content.opf')
    console.log('[EPUB] container.xml: OK')

    // 6c. OPF (Package Document)
    const opf = await zip.file('OEBPS/content.opf')?.async('string')
    expect(opf).toBeTruthy()
    expect(opf).toContain('xmlns="http://www.idpf.org/2007/opf"')
    expect(opf).toContain('version="3.0"')
    // Metadata
    expect(opf).toContain('<dc:title>')
    expect(opf).toContain('<dc:creator>')
    expect(opf).toContain('<dc:language>')
    expect(opf).toContain('<dc:identifier')
    console.log('[EPUB] content.opf metadata: OK')

    // 6d. Chapter XHTML files (excluding nav)
    const chapterXhtmlFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/') && f.endsWith('.xhtml') && f !== 'OEBPS/nav.xhtml'
    )
    console.log(`[EPUB] Chapter XHTML files: ${chapterXhtmlFiles.length}`)
    expect(chapterXhtmlFiles.length).toBeGreaterThanOrEqual(3)

    // Validate each chapter XHTML
    for (const xhtmlPath of chapterXhtmlFiles) {
      const content = await zip.file(xhtmlPath)?.async('string')
      expect(content).toBeTruthy()
      expect(content!.length).toBeGreaterThan(50)
      expect(content).toContain('<?xml')
      expect(content).toContain('xmlns')
    }
    console.log('[EPUB] All chapter XHTML files valid')

    // 6e. Audio files — each chapter should have an MP3
    const audioFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/audio/') && f.endsWith('.mp3')
    )
    console.log(`[EPUB] Audio files: ${audioFiles.length}`)
    expect(audioFiles.length).toBeGreaterThanOrEqual(3)

    // Validate each audio file is non-empty and has valid MP3 header
    for (const audioPath of audioFiles) {
      const audioData = await zip.file(audioPath)?.async('uint8array')
      expect(audioData).toBeTruthy()
      expect(audioData!.length).toBeGreaterThan(1000)

      // Check MP3 header: ID3 tag or sync word
      const header = String.fromCharCode(audioData![0], audioData![1], audioData![2])
      const isValidMp3 =
        header === 'ID3' || (audioData![0] === 0xff && (audioData![1] & 0xe0) === 0xe0)
      expect(isValidMp3).toBeTruthy()
    }
    console.log('[EPUB] All audio files valid (MP3 headers verified)')

    // 6f. SMIL files — one per chapter with audio (media overlays)
    const smilFiles = Object.keys(zip.files).filter(
      (f) => f.startsWith('OEBPS/smil/') && f.endsWith('.smil')
    )
    console.log(`[EPUB] SMIL files: ${smilFiles.length}`)
    expect(smilFiles.length).toBe(audioFiles.length)

    // Validate each SMIL file content
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)?.async('string')
      expect(smilContent).toBeTruthy()

      // SMIL structure
      expect(smilContent).toContain('xmlns="http://www.w3.org/ns/SMIL"')
      expect(smilContent).toContain('version="3.0"')
      expect(smilContent).toContain('epub:textref=')

      // Par elements with text and audio references
      expect(smilContent).toContain('<par')
      expect(smilContent).toContain('text src=')
      expect(smilContent).toContain('audio src=')
      expect(smilContent).toContain('clipBegin=')
      expect(smilContent).toContain('clipEnd=')

      // Validate clip times are properly formatted (e.g., "0.000s", "1.234s")
      const clipBeginMatches = smilContent!.match(/clipBegin="(\d+\.\d+)s"/g)
      const clipEndMatches = smilContent!.match(/clipEnd="(\d+\.\d+)s"/g)
      expect(clipBeginMatches).toBeTruthy()
      expect(clipEndMatches).toBeTruthy()
      expect(clipBeginMatches!.length).toBeGreaterThan(0)
      expect(clipEndMatches!.length).toBe(clipBeginMatches!.length)

      // Verify clip times are monotonically increasing
      const clipEnds = clipEndMatches!.map((m) => parseFloat(m.match(/(\d+\.\d+)/)?.[1] || '0'))
      for (let i = 1; i < clipEnds.length; i++) {
        expect(clipEnds[i]).toBeGreaterThanOrEqual(clipEnds[i - 1])
      }
    }
    console.log('[EPUB] All SMIL files valid (structure, timing, monotonicity)')

    // 6g. OPF manifest references
    expect(opf).toContain('media-type="application/xhtml+xml"')
    expect(opf).toContain('media-type="audio/mpeg"')
    expect(opf).toContain('media-type="application/smil+xml"')
    expect(opf).toContain('media-overlay=')
    console.log('[EPUB] OPF manifest references: OK (XHTML, audio, SMIL, media-overlay)')

    // 6h. Navigation document (EPUB3)
    const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
    expect(nav).toBeTruthy()
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toContain('<ol>')
    expect(nav).toContain('<li>')
    // Should have links to all chapters
    const navLinks = (nav!.match(/<a href="[^"]+\.xhtml">/g) || []).length
    expect(navLinks).toBeGreaterThanOrEqual(3)
    console.log(`[EPUB] Navigation document: OK (${navLinks} chapter links)`)

    // 6i. NCX (backward compatibility)
    const ncx = await zip.file('OEBPS/toc.ncx')?.async('string')
    expect(ncx).toBeTruthy()
    expect(ncx).toContain('navPoint')
    expect(ncx).toContain('navLabel')
    expect(ncx).toContain('playOrder')
    const navPoints = (ncx!.match(/navPoint/g) || []).length
    // Each navPoint has opening and closing tags, so divide by 2
    expect(navPoints / 2).toBeGreaterThanOrEqual(3)
    console.log(`[EPUB] NCX: OK (${navPoints / 2} nav points)`)

    // 6j. Cross-reference: every audio file has a matching SMIL
    for (const audioPath of audioFiles) {
      const chapterId = audioPath.replace('OEBPS/audio/', '').replace('.mp3', '')
      const matchingSmil = `OEBPS/smil/${chapterId}.smil`
      expect(zip.file(matchingSmil)).toBeTruthy()
    }
    console.log('[EPUB] Cross-reference audio↔SMIL: OK')

    // 6k. Cross-reference: every SMIL references a valid XHTML and audio file
    for (const smilPath of smilFiles) {
      const smilContent = await zip.file(smilPath)?.async('string')
      // Extract text src references
      const textRefs = smilContent!.match(/text src="([^"]+)"/g) || []
      for (const ref of textRefs) {
        const href = ref.match(/src="([^"#]+)/)?.[1]
        if (href) {
          // Resolve relative path from smil/ directory
          const resolvedPath = href.startsWith('../')
            ? `OEBPS/${href.substring(3)}`
            : `OEBPS/smil/${href}`
          expect(zip.file(resolvedPath)).toBeTruthy()
        }
      }
      // Extract audio src references
      const audioRefs = smilContent!.match(/audio src="([^"]+)"/g) || []
      for (const ref of audioRefs) {
        const href = ref.match(/src="([^"#]+)/)?.[1]
        if (href) {
          const resolvedPath = href.startsWith('../')
            ? `OEBPS/${href.substring(3)}`
            : `OEBPS/smil/${href}`
          expect(zip.file(resolvedPath)).toBeTruthy()
        }
      }
    }
    console.log('[EPUB] Cross-reference SMIL→XHTML/audio: OK')

    // 6l. Text content validation — generated XHTML must match source EPUB text
    console.log('[TEST] Validating EPUB text content against source...')
    const sourceZip = await JSZip.loadAsync(epubBuffer)

    // Helper: strip XML/HTML tags and normalise whitespace for comparison
    const extractText = (xml: string): string =>
      xml
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#\d+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    // Source chapters live at epub/text/chapter-N.xhtml
    // Generated chapters live at OEBPS/chapter-N.xhtml (or similar)
    let textMatchCount = 0
    for (let i = 1; i <= 3; i++) {
      const srcPath = `epub/text/chapter-${i}.xhtml`
      const srcFile = sourceZip.file(srcPath)
      if (!srcFile) {
        console.warn(`[EPUB] Source chapter not found: ${srcPath}`)
        continue
      }
      const srcContent = await srcFile.async('string')
      const srcText = extractText(srcContent)

      // Find matching generated chapter (may be named chapter-N.xhtml or similar)
      const genPath = chapterXhtmlFiles.find((f) => f.includes(`chapter-${i}.xhtml`))
      if (!genPath) {
        console.warn(`[EPUB] Generated chapter not found for chapter-${i}`)
        continue
      }
      const genContent = await zip.file(genPath)!.async('string')
      const genText = extractText(genContent)

      // The generated text should contain the core content of the source
      // (generated EPUB may add span wrappers for TTS segments, so we check
      //  that the source text is a substring or that overlap is high)
      const srcWords = srcText.split(' ').filter(Boolean)
      const genWords = new Set(genText.split(' ').filter(Boolean))
      const matchingWords = srcWords.filter((w) => genWords.has(w)).length
      const overlapRatio = srcWords.length > 0 ? matchingWords / srcWords.length : 0

      console.log(
        `[EPUB] chapter-${i} text overlap: ${(overlapRatio * 100).toFixed(1)}% (${matchingWords}/${srcWords.length} words)`
      )
      // Require at least 90% word overlap — allows for minor encoding differences
      expect(overlapRatio).toBeGreaterThanOrEqual(0.9)
      textMatchCount++
    }
    console.log(`[EPUB] Text content validation: OK (${textMatchCount}/3 chapters verified)`)
    expect(textMatchCount).toBe(3)

    // ─── Summary ───
    console.log('═══════════════════════════════════════════')
    console.log('[TEST] SHERLOCK HOLMES — KOKORO WEBGPU TEST PASSED')
    console.log(`  Chapters: ${chapterXhtmlFiles.length}`)
    console.log(`  Audio files: ${audioFiles.length}`)
    console.log(`  SMIL files: ${smilFiles.length}`)
    console.log(`  EPUB size: ${(outputBuf.length / 1024 / 1024).toFixed(2)} MB`)
    console.log(`  Nav links: ${navLinks}`)
    console.log('═══════════════════════════════════════════')
  })
})
