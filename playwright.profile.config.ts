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
 */
export default defineConfig({
  testDir: './e2e/profile',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 3_600_000,
  use: {
    baseURL: 'http://localhost:5173',
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

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
