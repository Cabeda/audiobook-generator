import { defineConfig } from '@playwright/test'
import process from 'node:process'

/**
 * Profiling config — long-running full-book runs that collect memory, CPU and
 * allocation artifacts (see docs/PROFILING.md).
 *
 * Kept out of `playwright.config.ts` and `playwright.nightly.config.ts` because
 * a run takes tens of minutes and needs the full Chromium build.
 *
 * Usage: pnpm test:e2e:profile
 *
 * Runs on its own dev server so it can share a machine with other agents:
 * PROFILE_PORT=5174 pnpm test:e2e:profile
 */
const PORT = Number(process.env.PROFILE_PORT ?? 5173)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e/profile',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // A 4.5 h audiobook takes ~2 h to generate on WASM; the trace and the heap
  // diffs add a few minutes on top.
  timeout: 4 * 60 * 60 * 1000,
  use: {
    baseURL: BASE_URL,
    // measureUserAgentSpecificMemory() and the Memory domain sampling profiler
    // are only exposed by the full Chromium build, not by headless_shell.
    channel: 'chromium',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],

  // Never reuse someone else's server: an editor saving a file in another
  // checkout would hot-reload the page mid-run and invalidate the measurements.
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
