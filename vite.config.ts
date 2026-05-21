import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Audiobook Generator',
        short_name: 'AudiobookGen',
        description: 'Generate audiobooks from eBooks locally.',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // Raised to cover large WASM chunks (Kokoro/Piper can be 50-200 MB each)
        maximumFileSizeToCacheInBytes: 250 * 1024 * 1024,
        clientsClaim: true,
        skipWaiting: false,
      },
    }),
  ],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
    include: ['jszip'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('onnxruntime-web') || id.includes('@diffusionstudio/vits-web')) {
            return 'piper-tts'
          }
          if (id.includes('pdfjs-dist')) {
            return 'pdf-parser'
          }
          if (id.includes('jszip')) {
            return 'zip'
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
