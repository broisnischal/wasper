import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

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
  ssr: {
    // Hotkeys are browser-only — never pull them into the SSR worker bundle.
    external: ['@tanstack/react-hotkeys', '@tanstack/react-store'],
  },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
