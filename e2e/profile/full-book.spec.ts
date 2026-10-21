import { test, expect, type CDPSession, type Page } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import process from 'node:process'

const EPUB = join(process.cwd(), 'books', 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub')
const OUT = join(process.cwd(), 'test-results', 'profile')

/** How often to sample memory. Each sample forces a GC, so keep it coarse. */
const SAMPLE_INTERVAL_MS = 5_000

/**
 * Chrome samples the CPU at ~7 kHz in tracing mode and neither the sampling
 * interval nor the trace buffer size is configurable, so a full-book trace runs
 * to gigabytes. Record a fixed window instead: ~140 MB, loadable in DevTools,
 * covering model load and the first chapters. Raise it to cover more.
 */
const TRACE_WINDOW_MS = 90_000

type MemorySample = {
  elapsedSec: number
  /** Whole agent cluster: main thread + TTS worker + its WASM heap. */
  agentMB: number
  mainThreadMB: number
  ttsWorkerMB: number
  /** V8 JS heap of the main thread only (CDP Performance.getMetrics). */
  mainHeapMB: number
  domNodes: number
  listeners: number
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10

/**
 * `performance.measureUserAgentSpecificMemory()` reports the whole agent
 * cluster — the page *and* its dedicated worker, including the ONNX/WASM heap
 * that `performance.memory` and JS heap metrics cannot see. It forces a GC, so
 * every sample is live (retained) memory.
 *
 * `bytes` is exact; the per-context split is best effort, so a terminated worker
 * can show up under `Window`. Trust the total, not the split.
 */
async function readAgentMemory(page: Page) {
  return page.evaluate(async () => {
    const perf = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{
        bytes: number
        breakdown: { bytes: number; attribution: { scope: string }[] }[]
      }>
    }
    if (!perf.measureUserAgentSpecificMemory)
      throw new Error('measureUserAgentSpecificMemory missing')
    const result = await perf.measureUserAgentSpecificMemory()
    let mainThreadBytes = 0
    let ttsWorkerBytes = 0
    for (const part of result.breakdown) {
      const scopes = part.attribution.map((a) => a.scope).join(',')
      if (scopes.includes('DedicatedWorker')) ttsWorkerBytes += part.bytes
      else if (scopes.includes('Window')) mainThreadBytes += part.bytes
    }
    return { agentBytes: result.bytes, mainThreadBytes, ttsWorkerBytes }
  })
}

async function takeSample(cdp: CDPSession, page: Page, startedAt: number): Promise<MemorySample> {
  const agent = await readAgentMemory(page)
  const metrics = await cdp.send('Performance.getMetrics')
  const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0
  const dom = await cdp.send('Memory.getDOMCounters')
  return {
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    agentMB: mb(agent.agentBytes),
    mainThreadMB: mb(agent.mainThreadBytes),
    ttsWorkerMB: mb(agent.ttsWorkerBytes),
    mainHeapMB: mb(heap),
    domNodes: dom.nodes,
    listeners: dom.jsEventListeners,
  }
}

/**
 * Full `.heapsnapshot` of the main thread with a forced GC first. Two of these
 * (baseline + final) diffed in DevTools' Memory panel "Comparison" view show
 * exactly which objects survived the run — i.e. potential leaks.
 *
 * Only the V8 heap is in here: Blob and WASM memory live outside it, so a small
 * snapshot next to a large `agentMB` is expected.
 */
async function takeHeapSnapshot(cdp: CDPSession, path: string) {
  const chunks: string[] = []
  const onChunk = (event: { chunk: string }) => chunks.push(event.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  try {
    await cdp.send('HeapProfiler.enable')
    await cdp.send('HeapProfiler.collectGarbage')
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  }
  await writeFile(path, chunks.join(''))
  return chunks.join('').length
}

/**
 * Chrome trace with V8 CPU sampling. Opens in the DevTools Performance panel and
 * gives a flame graph for the main thread *and* the TTS worker thread (the
 * `DedicatedWorker thread` track). Sampling has to be switched on explicitly —
 * Playwright's `browser.startTracing()` does not enable it.
 */
async function startTrace(cdp: CDPSession) {
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      enableSampling: true,
      includedCategories: [
        '-*',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-v8.cpu_profiler',
        'v8.execute',
        'blink.console',
        'blink.user_timing',
      ],
    },
  })
}

async function stopTrace(cdp: CDPSession, path: string) {
  const complete = new Promise<{ stream?: string }>((resolve) => {
    cdp.once('Tracing.tracingComplete', resolve)
  })
  await cdp.send('Tracing.end')
  const { stream } = await complete
  if (!stream) throw new Error('Tracing ended without a stream')
  const chunks: string[] = []
  for (;;) {
    const read = await cdp.send('IO.read', { handle: stream, size: 16 * 1024 * 1024 })
    if (read.data) chunks.push(read.data)
    if (read.eof) break
  }
  await cdp.send('IO.close', { handle: stream })
  const body = chunks.join('')
  await writeFile(path, body)
  return body.length
}

test.describe('Full book profiling', () => {
  test('collects memory, CPU and allocation artifacts for a full book', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only')

    await mkdir(OUT, { recursive: true })

    // ─── Setup: Kokoro WASM q4, the config the reliability tests use ───
    await page.goto('/')
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

    const supported = await page.evaluate(
      () =>
        typeof (performance as Performance & { measureUserAgentSpecificMemory?: unknown })
          .measureUserAgentSpecificMemory === 'function'
    )
    expect(
      supported,
      'measureUserAgentSpecificMemory is missing — run this suite with `channel: "chromium"`'
    ).toBe(true)

    let workerRestarts = 0
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes('Restarting TTS worker')) workerRestarts++
      if (text.includes('[OOM mitigation]')) console.log(`[PAGE] ${text}`)
    })

    // ─── Start the instruments before upload ───
    // Uploading a book auto-selects every chapter and starts generation, so the
    // instruments have to be running first or the model load is missed.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const startedAt = Date.now()

    const baseline = await takeSample(cdp, page, startedAt)
    console.log(`[PROFILE] baseline agent memory: ${baseline.agentMB} MB`)

    // Allocation flame graph: samples every allocation >= 32 KB, by stack.
    await cdp.send('Memory.startSampling', { samplingInterval: 32 * 1024 })
    const baselineSnapshotBytes = await takeHeapSnapshot(cdp, join(OUT, 'heap-before.heapsnapshot'))
    console.log(`[PROFILE] baseline heap snapshot: ${mb(baselineSnapshotBytes)} MB`)
    await startTrace(cdp)
    let traceBytes = 0
    let traceStopped = false
    const finishTrace = async () => {
      if (traceStopped) return
      traceStopped = true
      traceBytes = await stopTrace(cdp, join(OUT, 'trace.json'))
    }
    const traceTimer = setTimeout(() => void finishTrace(), TRACE_WINDOW_MS)

    const samples: MemorySample[] = [baseline]
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        await page.waitForTimeout(SAMPLE_INTERVAL_MS)
        if (!sampling) break
        try {
          const sample = await takeSample(cdp, page, startedAt)
          samples.push(sample)
          console.log(
            `[MEMORY] ${sample.elapsedSec}s agent=${sample.agentMB}MB ` +
              `main=${sample.mainThreadMB}MB worker=${sample.ttsWorkerMB}MB ` +
              `dom=${sample.domNodes} listeners=${sample.listeners}`
          )
        } catch {
          // The renderer can be busy inside ONNX inference — skip this tick.
        }
      }
    })()

    // ─── Upload the book; the app selects all chapters and starts generating ───
    await page.locator('input[type="file"]').setInputFiles({
      name: 'arthur-conan-doyle_the-sign-of-the-four_advanced.epub',
      mimeType: 'application/epub+zip',
      buffer: await readFile(EPUB),
    })
    await page.waitForSelector('text=/Sign of the Four/i', { timeout: 30_000 })
    const detected = await page.locator('input[type="checkbox"]').count()
    console.log(`[PROFILE] chapters detected: ${detected}`)
    expect(detected).toBeGreaterThan(0)

    // Generation must actually be running before waiting for it to finish.
    await page.waitForSelector('button[aria-label="Cancel this chapter"]', { timeout: 120_000 })
    await page.waitForFunction(
      () => {
        const stateCleared = localStorage.getItem('audiobook_generation_state') === null
        const noCancel =
          document.querySelectorAll('button[aria-label="Cancel this chapter"]').length === 0
        return stateCleared && noCancel
      },
      { timeout: 3_000_000, polling: 10_000 }
    )
    console.log('[PROFILE] generation finished')

    // Let the final IndexedDB writes and store updates settle before measuring.
    await page.waitForTimeout(5_000)
    sampling = false
    await sampler
    const finalSample = await takeSample(cdp, page, startedAt)
    samples.push(finalSample)

    // ─── Stop the instruments and write artifacts ───
    clearTimeout(traceTimer)
    await finishTrace()
    const { profile } = await cdp.send('Memory.getSamplingProfile')
    await writeFile(join(OUT, 'allocations.heapprofile'), JSON.stringify(profile))
    const finalSnapshotBytes = await takeHeapSnapshot(cdp, join(OUT, 'heap-after.heapsnapshot'))
    console.log(`[PROFILE] final heap snapshot: ${mb(finalSnapshotBytes)} MB`)
    await cdp.detach().catch(() => {})

    const peak = samples.reduce((a, b) => (b.agentMB > a.agentMB ? b : a))
    const postRunGrowth = finalSample.mainThreadMB / Math.max(baseline.mainThreadMB, 0.1)

    const report = {
      generatedAt: new Date().toISOString(),
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      traceWindowSec: TRACE_WINDOW_MS / 1000,
      workerRestarts,
      sampleCount: samples.length,
      baseline,
      final: finalSample,
      peak,
      mainThreadGrowthRatio: postRunGrowth,
      artifacts: {
        memoryCsv: join(OUT, 'memory.csv'),
        trace: join(OUT, 'trace.json'),
        allocations: join(OUT, 'allocations.heapprofile'),
        heapBefore: join(OUT, 'heap-before.heapsnapshot'),
        heapAfter: join(OUT, 'heap-after.heapsnapshot'),
      },
    }
    await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    await writeFile(
      join(OUT, 'memory.csv'),
      [
        'elapsed_s,agent_mb,main_thread_mb,tts_worker_mb,main_heap_mb,dom_nodes,listeners',
        ...samples.map((s) =>
          [
            s.elapsedSec,
            s.agentMB,
            s.mainThreadMB,
            s.ttsWorkerMB,
            s.mainHeapMB,
            s.domNodes,
            s.listeners,
          ].join(',')
        ),
      ].join('\n')
    )

    console.log(
      [
        '',
        '════════════════ FULL BOOK PROFILE ════════════════',
        `  duration:        ${report.durationSec}s`,
        `  worker restarts: ${workerRestarts}`,
        `  samples:         ${samples.length}`,
        `  baseline agent:  ${baseline.agentMB} MB`,
        `  peak agent:      ${peak.agentMB} MB (at ${peak.elapsedSec}s)`,
        `  peak worker:     ${Math.max(...samples.map((s) => s.ttsWorkerMB))} MB`,
        `  final agent:     ${finalSample.agentMB} MB`,
        `  main growth:     ${postRunGrowth.toFixed(2)}x (${baseline.mainThreadMB} → ${finalSample.mainThreadMB} MB)`,
        `  DOM nodes:       ${baseline.domNodes} → ${finalSample.domNodes}`,
        `  listeners:       ${baseline.listeners} → ${finalSample.listeners}`,
        `  trace:           ${mb(traceBytes)} MB`,
        `  artifacts:       ${OUT}`,
        '═══════════════════════════════════════════════════',
        '',
      ].join('\n')
    )

    // Hard ceiling only — growth ratios are reported, not asserted, because the
    // worker restarts and the indexer legitimately move the numbers around.
    expect(peak.agentMB).toBeLessThan(4096)
  })
})
