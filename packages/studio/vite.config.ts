import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

// Monaco (editor + language web-workers) and Shiki (its MB-sized grammars) are
// strictly client-only: they're reached only through `import()` inside useEffect
// / React.lazy / `typeof window !== 'undefined'` guards, so they never execute
// during SSR. But the Cloudflare worker build bundles every dependency (a Worker
// can't externalise to node_modules), so these heavy lazy chunks still get
// emitted into dist/server — and a Worker's size limit counts *every* uploaded
// module, even lazy ones it never runs. That alone is ~28MB and blows the 3 MiB
// limit. Stub them to empty modules in the worker ('ssr') build only; the client
// build is untouched and loads the real modules at runtime. SSR HTML is identical
// because these components render plain fallbacks until they hydrate.
const stubClientOnlyInWorker = (): Plugin => {
  const STUB = '\0wasper-client-only-stub'
  const shouldStub = (id: string) =>
    id === 'monaco-editor' ||
    id.startsWith('monaco-editor/') ||
    id === '@monaco-editor/react' ||
    id === 'shiki' ||
    id.startsWith('shiki/') ||
    // The whole monaco setup module is client-only. Stubbing it here keeps the
    // SSR graph from ever descending into its `?worker` imports (Monaco compiles
    // those in a nested build whose environment isn't 'ssr', so the package-level
    // rules above can't catch the resulting ts/css/html/json.worker chunks).
    id === '../lib/monaco' ||
    id.endsWith('/lib/monaco') ||
    id.endsWith('/lib/monaco.ts')
  return {
    name: 'wasper:stub-client-only-in-worker',
    enforce: 'pre',
    resolveId(id) {
      if (this.environment?.name !== 'ssr') return null
      if (shouldStub(id)) return STUB
      return null
    },
    load(id) {
      if (id !== STUB) return null
      // A `default` export covers both `import worker from '…?worker'` and the
      // React.lazy default; `loader` covers `@monaco-editor/react`'s named export.
      // Proxy keeps any other named import resolving to a harmless no-op — none of
      // it ever executes server-side.
      return `const noop = new Proxy(() => {}, { get: () => noop })
export default noop
export const loader = noop`
    },
  }
}

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
    stubClientOnlyInWorker(),
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
