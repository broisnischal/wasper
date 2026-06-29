// Post-build service-worker generator.
//
// vite-plugin-pwa emits the web manifest fine, but its SW-generation hook
// (closeBundle) silently no-ops inside TanStack Start's environment-based build
// on Vite 8. So we generate the precache SW here with Workbox's build API —
// reliable and independent of build orchestration timing.
//
// Output: dist/client/sw.js  (served at /sw.js by the Cloudflare static assets).
import { generateSW } from 'workbox-build';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '../dist/client');

const { count, size, warnings } = await generateSW({
  globDirectory: clientDir,
  swDest: resolve(clientDir, 'sw.js'),
  // Precache only the small, stable shell (CSS / fonts / icons / manifest).
  // JS is intentionally NOT precached — there are 100+ lazy chunks (shiki
  // grammars, Monaco, per-route bundles) totalling ~9 MB; downloading all of
  // that on install would be slower, not faster. Instead JS is cached on first
  // use via the StaleWhileRevalidate runtime rule below, so repeat visits serve
  // the chunks you actually use instantly while revalidating in the background.
  globPatterns: ['**/*.{css,woff2,woff,png,svg,ico,webmanifest}'],
  globIgnores: ['sw.js'],
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  // HTML is server-rendered (not in dist/client), so no navigateFallback.
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  sourcemap: false,
  runtimeCaching: [
    {
      // Lazy chunks (Monaco, shiki grammars, route bundles) — cache on first use.
      urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'app-assets', expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 30 } },
    },
    {
      urlPattern: ({ request }) => request.destination === 'font',
      handler: 'CacheFirst',
      options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
    },
  ],
});

for (const w of warnings) console.warn('[build-sw]', w);
console.log(`[build-sw] precached ${count} files, ${(size / 1024 / 1024).toFixed(2)} MB → dist/client/sw.js`);
