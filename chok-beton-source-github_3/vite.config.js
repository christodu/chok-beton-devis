import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/chok-beton-devis/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'logo.jpg'],
      manifest: {
        name: "CHOK'BÉTON — Devis",
        short_name: "Devis CB",
        description: "Générateur de devis CHOK'BÉTON",
        theme_color: '#E8A838',
        background_color: '#F4F4F4',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/chok-beton-devis/',
        start_url: '/chok-beton-devis/',
        lang: 'fr',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 31536000 }
            }
          }
        ]
      }
    })
  ]
})
