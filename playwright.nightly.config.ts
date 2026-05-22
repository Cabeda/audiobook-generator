import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

/**
 * Nightly config — runs ALL e2e tests including expensive TTS generation tests.
 * Usage: pnpm test:e2e:nightly
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/smoke/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'list',
  timeout: 300000, // 5 min per test
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
