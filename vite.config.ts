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
        // Cache FFmpeg WASM core from CDN so export works offline after first use
        runtimeCaching: [
          {
            urlPattern: /cdn\.jsdelivr\.net\/npm\/@ffmpeg/,
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'ffmpeg-core',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
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
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'pdfjs-dist'],
    include: ['jszip'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'piper-tts': ['onnxruntime-web', '@diffusionstudio/vits-web'],
          'pdf-parser': ['pdfjs-dist'],
          zip: ['jszip'],
          ffmpeg: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
