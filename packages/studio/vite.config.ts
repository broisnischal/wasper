import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { VitePWA } from 'vite-plugin-pwa'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  optimizeDeps: {
    // Pre-bundle CJS shims used by @tanstack/react-store → @tanstack/react-hotkeys.
    include: [
      'use-sync-external-store/shim/with-selector.js',
      '@tanstack/react-store',
      '@tanstack/react-hotkeys',
    ],
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // PWA manifest + installability. This is an SSR app (no static index.html)
    // built via TanStack Start's environment orchestration, where the plugin's
    // SW-generation hook doesn't fire — so the precache service worker is
    // generated reliably post-build by scripts/build-sw.mjs, and the SW +
    // manifest are registered/linked manually (see __root.tsx).
    VitePWA({
      injectRegister: null,
      manifest: {
        name: 'Wasper Studio',
        short_name: 'Wasper',
        description: 'Fast OpenAPI client, explorer & proxy studio.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/logo192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo512.png', sizes: '512x512', type: 'image/png' },
          { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})

export default config
