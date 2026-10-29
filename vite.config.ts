import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE || '/'
/** Bump with BUILD_STAMP so Workbox opens a new cache and drops the stuck Goal-only SW. */
const PWA_CACHE_ID = 'heat-highlight-tap-lb-slip-1'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        cacheId: PWA_CACHE_ID,
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Heat Highlight Tap',
        short_name: 'Highlight Tap',
        description:
          'California Heat highlight tap — Goal, Sync, Shift, Export XML for James Perry',
        theme_color: '#0c1117',
        background_color: '#070b10',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        // Force manifest clients to notice a new installable revision
        id: `${base}#${PWA_CACHE_ID}`,
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
