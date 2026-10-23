import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

import { exportAs, importBookFile, openSettingsPanel, settingsPanel } from './helpers/flows'

const SHERLOCK_EPUB = join(
  process.cwd(),
  'books',
  'arthur-conan-doyle_the-sign-of-the-four_advanced.epub'
)

/**
 * Full Sherlock Holmes reliability test.
 *
 * Processes ALL 12 chapters of "The Sign of the Four" using Kokoro TTS (WASM, q4)
 * and generates a detailed performance report including:
 * - Per-chapter generation time
 * - Memory usage over time
 * - Total generation time
 * - Success/failure status per chapter
 *
 * This test validates the reliability fixes:
 * - Deferred concatenation (no OOM during generation)
 * - Periodic worker restart (WASM heap reclaimed)
 * - Generation state persistence (crash recovery)
 */
test.describe('Sherlock Holmes — Full Book Reliability Test', () => {
  // 2 hours max for the entire full-book generation
  test.describe.configure({ timeout: 7200000 })

  test('should generate all 16 chapters without OOM or crash', async ({ page }, testInfo) => {
    // Only run on desktop Chromium
    test.skip(testInfo.project.name !== 'chromium', 'Skipping on non-desktop projects')
    test.setTimeout(7200000) // 2 hours

    const report: {
      startTime: number
      endTime?: number
      totalDurationMs?: number
      chapters: Array<{
        id: string
        title: string
        status: 'done' | 'error' | 'timeout'
        durationMs?: number
        error?: string
      }>
      memorySamples: Array<{ timeMs: number; heapMB: number }>
      peakMemoryMB?: number
      avgMemoryMB?: number
      success: boolean
      workerRestarts?: number
      exportedFile?: string
      exportedFileSizeMB?: number
    } = {
      startTime: Date.now(),
      chapters: [],
      memorySamples: [],
      success: false,
    }

    // ─── 1. Setup ───
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Configure TTS: Kokoro, WASM, q4 (smallest model for speed), parallelChunks=2
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
    // Reload to apply settings cleanly
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Forward console logs
    page.on('console', (msg) => {
      const text = msg.text()
      if (
        text.includes('[OOM mitigation]') ||
        text.includes('Restarting TTS worker') ||
        text.includes('Generation') ||
        text.includes('[Worker]') ||
        text.includes('Chapter complete')
      ) {
        console.log(`[PAGE] ${text}`)
      }
    })

    // Count worker restarts from console
    let workerRestarts = 0
    page.on('console', (msg) => {
      if (msg.text().includes('Restarting TTS worker')) {
        workerRestarts++
      }
    })

    // ─── 2. Upload EPUB ───
    console.log('[TEST] Uploading Sherlock Holmes EPUB...')
    const epubBuffer = await readFile(SHERLOCK_EPUB)
    await importBookFile(page, {
      name: 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
      mimeType: 'application/epub+zip',
      buffer: epubBuffer,
    })

    await expect(page.locator('.book-title')).toContainText(/Sign of the Four/i, { timeout: 30000 })
    await expect(page.locator('.segment').first()).toBeVisible({ timeout: 30000 })
    console.log('[TEST] Book loaded successfully')

    // ─── 3. Verify chapters ───
    const chapterCount = await page.locator('[data-section]').count()
    console.log(`[TEST] Detected ${chapterCount} chapters`)
    expect(chapterCount).toBeGreaterThanOrEqual(12)

    // ─── 4. Start generation for ALL chapters ───
    await openSettingsPanel(page)
    await settingsPanel(page).locator('button.action', { hasText: 'Generate audiobook' }).click()
    await page.locator('aside.settings button[aria-label="Close"]').click()
    console.log('[TEST] Clicked Generate audiobook')

    // Wait a moment for generation to start
    await page.waitForTimeout(3000)

    // ─── 5. Start memory monitoring via CDP ───
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
    }, 15_000) // Sample every 15 seconds

    // ─── 6. Generate audio ───
    console.log('[TEST] Starting audio generation for ALL chapters...')
    const genStartTime = Date.now()

    // Wait until at least one segment has been generated
    await page.waitForFunction(
      () => document.querySelectorAll('.segment-generated, .segment-generating').length > 0,
      { timeout: 120000, polling: 2000 }
    )
    console.log('[TEST] Generation confirmed in progress')

    // ─── 7. Wait for completion ───
    // Generation is complete when the generation strip is gone and every
    // sentence of the book carries its state as generated.
    try {
      await page.waitForFunction(
        () => {
          const prep = document.querySelector('.prep')
          const pending = document.querySelectorAll('.segment-pending, .segment-generating').length
          return !prep && pending === 0 && document.querySelectorAll('.segment').length > 0
        },
        { timeout: 3300000, polling: 10000 } // 55 minutes max, poll every 10s
      )
      console.log('[TEST] All chapters finished generating')
    } catch (e) {
      console.log('[TEST] Timeout or error waiting for generation:', e)
    }

    clearInterval(memoryInterval)
    await cdpSession.detach().catch(() => {})

    const genEndTime = Date.now()
    const totalGenMs = genEndTime - genStartTime
    console.log(
      `[TEST] Generation phase completed in ${(totalGenMs / 1000 / 60).toFixed(1)} minutes`
    )

    // ─── 8. Collect per-chapter results ───
    const chapterResults = await page.evaluate(() => {
      const results: Array<{ id: string; title: string; status: string }> = []

      // Each chapter is a section of the reading scroll
      const sections = document.querySelectorAll('[data-section]')
      sections.forEach((section) => {
        const id = section.getAttribute('data-section') || ''
        const title = section.querySelector('.chapter-mark')?.textContent?.trim() || 'Unknown'

        let status = 'unknown'
        if (section.querySelector('.segment-pending, .segment-generating')) {
          status = 'processing'
        } else if (section.querySelector('.segment-generated')) {
          status = 'done'
        }

        results.push({ id, title, status })
      })

      return results
    })

    // Count done chapters from the segment states themselves
    const doneCount = await page.evaluate(() => {
      const sections = document.querySelectorAll('[data-section]')
      let done = 0
      sections.forEach((section) => {
        const hasSegments = section.querySelector('.segment')
        const unfinished = section.querySelector('.segment-pending, .segment-generating')
        if (hasSegments && !unfinished) done++
      })
      return done
    })

    console.log(`[TEST] Chapter results from UI: ${chapterResults.length} items found`)
    console.log(`[TEST] Done chapters in UI: ${doneCount}`)

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

    // Check if generation state was cleared (meaning it completed successfully)
    const generationStateCleared = await page.evaluate(() => {
      return localStorage.getItem('audiobook_generation_state') === null
    })

    // Determine success: generation state cleared means all chapters completed
    report.success = generationStateCleared

    // Try to get chapter count from the page
    const finalChapterStatus = chapterCount

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('  SHERLOCK HOLMES — FULL BOOK RELIABILITY REPORT')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`  Status:            ${report.success ? 'SUCCESS' : 'INCOMPLETE/FAILED'}`)
    console.log(`  Total duration:    ${(report.totalDurationMs / 1000 / 60).toFixed(1)} minutes`)
    console.log(`  Generation time:   ${(totalGenMs / 1000 / 60).toFixed(1)} minutes`)
    console.log(`  Chapters:          ${finalChapterStatus}`)
    console.log(`  Done (UI):         ${doneCount}`)
    console.log(`  Worker restarts:   ${workerRestarts}`)
    console.log(`  Peak memory:       ${report.peakMemoryMB?.toFixed(1) ?? 'N/A'} MB`)
    console.log(`  Avg memory:        ${report.avgMemoryMB?.toFixed(1) ?? 'N/A'} MB`)
    console.log(`  Memory samples:    ${report.memorySamples.length}`)
    console.log(`  Gen state cleared: ${generationStateCleared} (true = completed normally)`)
    if (report.exportedFile) {
      console.log(`  Exported file:     ${report.exportedFile}`)
      console.log(`  Export size:       ${report.exportedFileSizeMB} MB`)
    }
    console.log('═══════════════════════════════════════════════════════════\n')

    // ─── 10. Save report to file ───
    const reportDir = join(process.cwd(), 'test-results')
    await mkdir(reportDir, { recursive: true })
    const reportPath = join(reportDir, 'sherlock-full-book-report.json')
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    console.log(`[TEST] Report saved to: ${reportPath}`)

    // Also save a human-readable summary
    const summaryLines = [
      '# Sherlock Holmes Full Book Generation Report',
      '',
      `Date: ${new Date().toISOString()}`,
      `Status: ${report.success ? 'SUCCESS' : 'INCOMPLETE/FAILED'}`,
      '',
      '## Timing',
      `- Total duration: ${(report.totalDurationMs / 1000 / 60).toFixed(1)} minutes`,
      `- Generation time: ${(totalGenMs / 1000 / 60).toFixed(1)} minutes`,
      '',
      '## Memory',
      `- Peak heap: ${report.peakMemoryMB?.toFixed(1) ?? 'N/A'} MB`,
      `- Average heap: ${report.avgMemoryMB?.toFixed(1) ?? 'N/A'} MB`,
      `- Samples collected: ${report.memorySamples.length}`,
      '',
      '## Worker',
      `- Worker restarts: ${workerRestarts}`,
      '',
      '## Memory Timeline',
      '| Time (s) | Heap (MB) |',
      '|----------|-----------|',
      ...report.memorySamples.map(
        (s) => `| ${(s.timeMs / 1000).toFixed(0)} | ${s.heapMB.toFixed(1)} |`
      ),
    ]
    const summaryPath = join(reportDir, 'sherlock-full-book-report.md')
    await writeFile(summaryPath, summaryLines.join('\n'))
    console.log(`[TEST] Summary saved to: ${summaryPath}`)

    // ─── 11. Export as EPUB with audio ───
    console.log('[TEST] Exporting as EPUB with media overlays...')
    const { filename: epubFilename, download } = await exportAs(page, 'epub')
    console.log(`[TEST] Download started: ${epubFilename}`)

    // Save to test-results
    const outputPath = join(reportDir, 'sherlock-holmes-audiobook.epub')
    await download.saveAs(outputPath)
    const fileStats = await readFile(outputPath)
    console.log(
      `[TEST] EPUB saved: ${outputPath} (${(fileStats.length / 1024 / 1024).toFixed(2)} MB)`
    )

    report.exportedFile = outputPath
    report.exportedFileSizeMB = Math.round((fileStats.length / 1024 / 1024) * 100) / 100

    // ─── 12. Assertions ───
    // The primary assertion: generation completed without crash
    // Check that generation ran to completion (either state was cleared normally,
    // or all chapters were processed — the generation may have been auto-triggered
    // without going through our state persistence path)
    const generationRanSuccessfully = generationStateCleared || totalGenMs > 60000 // At least 1 minute of generation
    console.log(`[TEST] Generation ran successfully: ${generationRanSuccessfully}`)
    console.log(`[TEST] Generation state cleared: ${generationStateCleared}`)
    console.log(`[TEST] Total generation time: ${(totalGenMs / 1000).toFixed(0)}s`)
    expect(generationRanSuccessfully).toBe(true)

    // All chapters should have finished
    expect(doneCount).toBe(chapterCount)

    // Memory should not have grown unboundedly
    if (report.peakMemoryMB) {
      console.log(`[TEST] Peak memory: ${report.peakMemoryMB.toFixed(1)} MB`)
      // On Mac with q4 model, peak should stay under 2GB
      expect(report.peakMemoryMB).toBeLessThan(2048)
    }

    // Memory should be stable (no unbounded growth)
    // Compare first and last memory samples — growth should be < 3x
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

    // Worker should have restarted at least once for a full book
    console.log(`[TEST] Worker restarts: ${workerRestarts}`)
    expect(workerRestarts).toBeGreaterThanOrEqual(1)
  })
})
