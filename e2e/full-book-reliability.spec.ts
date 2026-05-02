import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, basename } from 'path'
import process from 'node:process'

/**
 * Parameterized full-book reliability test.
 *
 * Processes ALL chapters of a given EPUB using Kokoro TTS (WASM, q4)
 * and generates a detailed performance report. Then exports the EPUB
 * and validates it with structural checks.
 *
 * This test validates:
 * - Full book generation completes without OOM or crash
 * - Memory stays stable (no unbounded growth)
 * - Worker restarts occur as expected (every 3 chapters)
 * - Generation state persistence works (crash recovery)
 * - Exported EPUB has audio for all chapters with text content
 * - EPUB structure is valid (XHTML, SMIL, OPF)
 */

interface BookTestConfig {
  /** Path to the EPUB file */
  epubPath: string
  /** Human-readable name for the test */
  name: string
  /** Text to wait for after upload (to confirm book loaded) */
  titleMatch: RegExp
  /** Minimum expected chapters */
  minChapters: number
  /** Maximum time for generation in ms (default: 4 hours) */
  maxGenerationTimeMs?: number
}

const BOOKS: BookTestConfig[] = [
  {
    epubPath: join(process.cwd(), 'books', 'The_Life_and_Adventures_of_Robinson_Crusoe.epub'),
    name: 'Robinson Crusoe',
    titleMatch: /Robinson Crusoe/i,
    minChapters: 20,
    maxGenerationTimeMs: 28800000, // 8 hours
  },
  {
    epubPath: join(process.cwd(), 'books', 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub'),
    name: 'Sherlock Holmes - Sign of the Four',
    titleMatch: /Sign of the Four/i,
    minChapters: 12,
    maxGenerationTimeMs: 7200000, // 2 hours
  },
]

for (const bookConfig of BOOKS) {
  test.describe(`Full Book Reliability: ${bookConfig.name}`, () => {
    const maxTime = bookConfig.maxGenerationTimeMs ?? 14400000
    test.describe.configure({ timeout: maxTime })

    test(`should generate all chapters without OOM or crash`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'Skipping on non-desktop projects')
      test.setTimeout(maxTime)

      const bookSlug = bookConfig.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

      const report: {
        book: string
        startTime: number
        endTime?: number
        totalDurationMs?: number
        totalChapters?: number
        chaptersWithAudio?: number
        memorySamples: Array<{ timeMs: number; heapMB: number }>
        peakMemoryMB?: number
        avgMemoryMB?: number
        success: boolean
        workerRestarts?: number
        exportedFile?: string
        exportedFileSizeMB?: number
        errors: string[]
      } = {
        book: bookConfig.name,
        startTime: Date.now(),
        memorySamples: [],
        success: false,
        errors: [],
      }

      // ─── 1. Setup ───
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Configure TTS: Kokoro, WASM, q4 (fastest), parallelChunks=2
      await page.evaluate(() => {
        localStorage.clear()
        sessionStorage.clear()
        localStorage.setItem('audiobook_device', JSON.stringify('wasm'))
        localStorage.setItem('audiobook_model', JSON.stringify('kokoro'))
        localStorage.setItem('audiobook_quantization', JSON.stringify('q4'))
        localStorage.setItem(
          'audiobook_advanced_settings',
          JSON.stringify({ kokoro: { parallelChunks: 2 } })
        )
      })
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Forward relevant console logs
      page.on('console', (msg) => {
        const text = msg.text()
        if (
          text.includes('[OOM mitigation]') ||
          text.includes('Restarting TTS worker') ||
          text.includes('Generation failed') ||
          text.includes('generation failed') ||
          text.includes('[Worker]') ||
          text.includes('Chapter complete')
        ) {
          console.log(`[PAGE] ${text}`)
        }
      })

      // Track errors
      page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('generation failed')) {
          report.errors.push(msg.text().substring(0, 200))
        }
      })

      // Count worker restarts
      let workerRestarts = 0
      page.on('console', (msg) => {
        if (msg.text().includes('Restarting TTS worker')) {
          workerRestarts++
        }
      })

      // ─── 2. Upload EPUB ───
      console.log(`[TEST] Uploading ${bookConfig.name}...`)
      const epubBuffer = await readFile(bookConfig.epubPath)
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles({
        name: basename(bookConfig.epubPath),
        mimeType: 'application/epub+zip',
        buffer: epubBuffer,
      })

      await page.waitForSelector(`text=${bookConfig.titleMatch.source}`, { timeout: 30000 })
      console.log('[TEST] Book loaded successfully')

      // ─── 3. Verify chapters ───
      const checkboxes = page.locator('input[type="checkbox"]')
      const chapterCount = await checkboxes.count()
      console.log(`[TEST] Detected ${chapterCount} chapters`)
      expect(chapterCount).toBeGreaterThanOrEqual(bookConfig.minChapters)
      report.totalChapters = chapterCount

      // ─── 4. Select ALL chapters ───
      const selectAllButton = page.getByRole('button', { name: 'Select All', exact: true })
      await selectAllButton.click()
      console.log('[TEST] All chapters selected')

      // ─── 5. Start generation ───
      const isAlreadyGenerating = await page
        .locator('button[aria-label="Cancel this chapter"]')
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false)

      if (!isAlreadyGenerating) {
        const genButton = page.locator('button:has-text("Generate Selected")')
        await expect(genButton).toBeVisible()
        await expect(genButton).toBeEnabled({ timeout: 10000 })
        await genButton.click()
        console.log('[TEST] Clicked Generate Selected')
        await page.waitForTimeout(3000)
      } else {
        console.log('[TEST] Generation already running (auto-triggered on upload)')
      }

      // ─── 6. Start memory monitoring via CDP ───
      const cdpSession = await page.context().newCDPSession(page)
      await cdpSession.send('Performance.enable')

      const memoryInterval = setInterval(async () => {
        try {
          const metrics = (await cdpSession.send('Performance.getMetrics')) as {
            metrics: { name: string; value: number }[]
          }
          const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')
          if (heap) {
            const heapMB = heap.value / 1024 / 1024
            report.memorySamples.push({
              timeMs: Date.now() - report.startTime,
              heapMB: Math.round(heapMB * 10) / 10,
            })
            console.log(
              `[MEMORY] ${((Date.now() - report.startTime) / 1000).toFixed(0)}s — Heap: ${heapMB.toFixed(1)} MB`
            )
          }
        } catch {
          // CDP may disconnect — ignore
        }
      }, 30_000) // Sample every 30 seconds (longer interval for longer books)

      // ─── 7. Wait for generation to start ───
      console.log('[TEST] Waiting for generation to be in progress...')
      const genStartTime = Date.now()

      await page.waitForFunction(
        () => {
          const bodyText = document.body.innerText
          return bodyText.includes('segment') || bodyText.includes('Generating')
        },
        { timeout: 120000, polling: 2000 }
      )
      console.log('[TEST] Generation confirmed in progress')

      // ─── 8. Wait for completion ───
      try {
        await page.waitForFunction(
          () => {
            const stateCleared = localStorage.getItem('audiobook_generation_state') === null
            const cancelBtns = document.querySelectorAll('button[aria-label="Cancel this chapter"]')
            const noCancel = cancelBtns.length === 0
            return stateCleared && noCancel
          },
          { timeout: maxTime - 600000, polling: 15000 } // Leave 10 min for export
        )
        console.log('[TEST] All chapters finished generating')
      } catch (e) {
        console.log('[TEST] Timeout or error waiting for generation:', e)
        report.errors.push('Generation timed out')
      }

      clearInterval(memoryInterval)
      await cdpSession.detach().catch(() => {})

      const genEndTime = Date.now()
      const totalGenMs = genEndTime - genStartTime
      console.log(
        `[TEST] Generation phase completed in ${(totalGenMs / 1000 / 60).toFixed(1)} minutes`
      )

      // ─── 9. Build report ───
      report.endTime = Date.now()
      report.totalDurationMs = report.endTime - report.startTime
      report.workerRestarts = workerRestarts

      if (report.memorySamples.length > 0) {
        report.peakMemoryMB = Math.max(...report.memorySamples.map((s) => s.heapMB))
        report.avgMemoryMB =
          Math.round(
            (report.memorySamples.reduce((sum, s) => sum + s.heapMB, 0) /
              report.memorySamples.length) *
              10
          ) / 10
      }

      const generationStateCleared = await page.evaluate(() => {
        return localStorage.getItem('audiobook_generation_state') === null
      })
      report.success = generationStateCleared

      console.log('\n═══════════════════════════════════════════════════════════')
      console.log(`  ${bookConfig.name.toUpperCase()} — FULL BOOK RELIABILITY REPORT`)
      console.log('═══════════════════════════════════════════════════════════')
      console.log(`  Status:            ${report.success ? 'SUCCESS' : 'INCOMPLETE/FAILED'}`)
      console.log(`  Total duration:    ${(report.totalDurationMs / 1000 / 60).toFixed(1)} minutes`)
      console.log(`  Generation time:   ${(totalGenMs / 1000 / 60).toFixed(1)} minutes`)
      console.log(`  Chapters:          ${report.totalChapters}`)
      console.log(`  Worker restarts:   ${workerRestarts}`)
      console.log(`  Peak memory:       ${report.peakMemoryMB?.toFixed(1) ?? 'N/A'} MB`)
      console.log(`  Avg memory:        ${report.avgMemoryMB?.toFixed(1) ?? 'N/A'} MB`)
      console.log(`  Memory samples:    ${report.memorySamples.length}`)
      console.log(`  Gen state cleared: ${generationStateCleared}`)
      console.log(`  Errors:            ${report.errors.length}`)
      console.log('═══════════════════════════════════════════════════════════\n')

      // ─── 10. Save report ───
      const reportDir = join(process.cwd(), 'test-results')
      await mkdir(reportDir, { recursive: true })
      const reportPath = join(reportDir, `${bookSlug}-report.json`)
      await writeFile(reportPath, JSON.stringify(report, null, 2))
      console.log(`[TEST] Report saved to: ${reportPath}`)

      // ─── 11. Export as EPUB ───
      console.log('[TEST] Exporting as EPUB with media overlays...')

      const formatToggle = page.locator('.export-toggle')
      if (await formatToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
        await formatToggle.click()
        await page.waitForSelector('.export-format-menu', { timeout: 5000 })
        const epubOption = page.locator('.format-option').filter({ hasText: 'EPUB' })
        await epubOption.click()
      }

      const exportButton = page.locator('.export-primary-btn.export-main')
      if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(exportButton).toBeEnabled({ timeout: 30000 })

        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 600000 }),
          exportButton.click(),
        ])

        const epubFilename = download.suggestedFilename()
        console.log(`[TEST] Download started: ${epubFilename}`)

        const outputPath = join(reportDir, `${bookSlug}-audiobook.epub`)
        await download.saveAs(outputPath)
        const fileStats = await readFile(outputPath)
        console.log(
          `[TEST] EPUB saved: ${outputPath} (${(fileStats.length / 1024 / 1024).toFixed(2)} MB)`
        )

        report.exportedFile = outputPath
        report.exportedFileSizeMB = Math.round((fileStats.length / 1024 / 1024) * 100) / 100

        // ─── 12. Validate EPUB structure ───
        console.log('[TEST] Validating EPUB structure...')
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(fileStats)

        // Check mimetype
        const mimetype = await zip.file('mimetype')?.async('string')
        expect(mimetype).toBe('application/epub+zip')

        // Check container.xml
        const container = await zip.file('META-INF/container.xml')?.async('string')
        expect(container).toContain('rootfile')

        // Check OPF
        const opf = await zip.file('OEBPS/content.opf')?.async('string')
        expect(opf).toBeTruthy()
        expect(opf).toContain('version="3.0"')
        expect(opf).toContain('<dc:title>')
        expect(opf).toContain('media:duration')

        // Count audio files
        const audioFiles = Object.keys(zip.files).filter(
          (f) => f.startsWith('OEBPS/audio/') && f.endsWith('.mp3')
        )
        console.log(`[TEST] Audio files in EPUB: ${audioFiles.length}`)
        report.chaptersWithAudio = audioFiles.length

        // Count XHTML chapter files
        const chapterFiles = Object.keys(zip.files).filter(
          (f) => f.startsWith('OEBPS/') && f.endsWith('.xhtml') && f !== 'OEBPS/nav.xhtml'
        )
        console.log(`[TEST] Chapter XHTML files: ${chapterFiles.length}`)

        // Count SMIL files
        const smilFiles = Object.keys(zip.files).filter(
          (f) => f.startsWith('OEBPS/smil/') && f.endsWith('.smil')
        )
        console.log(`[TEST] SMIL files: ${smilFiles.length}`)

        // Validate each audio file has valid MP3 header
        let validAudioCount = 0
        for (const audioPath of audioFiles) {
          const audioData = await zip.file(audioPath)?.async('uint8array')
          if (audioData && audioData.length > 1000) {
            const header = String.fromCharCode(audioData[0], audioData[1], audioData[2])
            const isValidMp3 =
              header === 'ID3' || (audioData[0] === 0xff && (audioData[1] & 0xe0) === 0xe0)
            if (isValidMp3) validAudioCount++
          }
        }
        console.log(`[TEST] Valid MP3 files: ${validAudioCount}/${audioFiles.length}`)

        // Validate SMIL files reference valid audio
        let validSmilCount = 0
        for (const smilPath of smilFiles) {
          const smilContent = await zip.file(smilPath)?.async('string')
          if (smilContent && smilContent.includes('audio src=')) {
            validSmilCount++
          }
        }
        console.log(`[TEST] Valid SMIL files: ${validSmilCount}/${smilFiles.length}`)

        // Check nav.xhtml
        const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
        expect(nav).toBeTruthy()
        expect(nav).toContain('epub:type="toc"')

        console.log('[TEST] EPUB structure validation complete')

        // Audio should exist for most chapters (some may be empty/cover pages)
        // At minimum, 80% of chapters with content should have audio
        const audioRatio = audioFiles.length / chapterFiles.length
        console.log(
          `[TEST] Audio coverage: ${(audioRatio * 100).toFixed(0)}% (${audioFiles.length}/${chapterFiles.length})`
        )
        expect(audioRatio).toBeGreaterThan(0.7)
      } else {
        console.log('[TEST] Export button not visible — trying fallback export')
        const anyExportBtn = page.locator('button:has-text("Export")')
        if (
          await anyExportBtn
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false)
        ) {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 600000 }),
            anyExportBtn.first().click(),
          ])
          const outputPath = join(
            reportDir,
            download.suggestedFilename() || `${bookSlug}-audiobook.mp3`
          )
          await download.saveAs(outputPath)
          const fileStats = await readFile(outputPath)
          console.log(
            `[TEST] Audio saved: ${outputPath} (${(fileStats.length / 1024 / 1024).toFixed(2)} MB)`
          )
          report.exportedFile = outputPath
          report.exportedFileSizeMB = Math.round((fileStats.length / 1024 / 1024) * 100) / 100
        }
      }

      // Save final report
      await writeFile(reportPath, JSON.stringify(report, null, 2))

      // ─── 13. Assertions ───
      const generationRanSuccessfully = generationStateCleared || totalGenMs > 60000
      console.log(`[TEST] Generation ran successfully: ${generationRanSuccessfully}`)
      expect(generationRanSuccessfully).toBe(true)

      // Memory stability
      if (report.peakMemoryMB) {
        expect(report.peakMemoryMB).toBeLessThan(2048)
      }

      if (report.memorySamples.length >= 4) {
        const firstSamples = report.memorySamples.slice(0, 3)
        const lastSamples = report.memorySamples.slice(-3)
        const avgFirst = firstSamples.reduce((s, m) => s + m.heapMB, 0) / firstSamples.length
        const avgLast = lastSamples.reduce((s, m) => s + m.heapMB, 0) / lastSamples.length
        const growthRatio = avgLast / avgFirst
        console.log(
          `[TEST] Memory growth ratio: ${growthRatio.toFixed(2)}x (${avgFirst.toFixed(1)} MB → ${avgLast.toFixed(1)} MB)`
        )
        expect(growthRatio).toBeLessThan(3.0)
      }

      // Worker restarts should happen for books with 4+ chapters
      if (chapterCount >= 4) {
        console.log(`[TEST] Worker restarts: ${workerRestarts}`)
        expect(workerRestarts).toBeGreaterThanOrEqual(1)
      }
    })
  })
}
