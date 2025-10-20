import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Exclude E2E tests (Playwright) from vitest
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
    // jsdom doesn't automatically load external resources, avoiding CSS fetch errors
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
  },
})
