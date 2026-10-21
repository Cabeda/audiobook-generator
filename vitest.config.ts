import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // The default 5s flakes under full-suite parallel load (epubParser,
    // audioConcat, the integration suite); they pass in isolation.
    testTimeout: 15_000,
    // Exclude E2E tests (Playwright) from vitest
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    // jsdom doesn't automatically load external resources, avoiding CSS fetch errors
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
    setupFiles: ['./test/setup.ts'],
  },
})
