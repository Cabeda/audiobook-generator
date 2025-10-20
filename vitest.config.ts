import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // jsdom doesn't automatically load external resources, avoiding CSS fetch errors
    environmentOptions: {
      jsdom: {
        resources: 'usable'
      }
    }
  },
})
