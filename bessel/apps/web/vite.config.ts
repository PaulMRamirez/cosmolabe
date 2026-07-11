import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The canonical build all targets consume (SPEC Section 7). vite-plugin-pwa
// supplies the Workbox service worker and the web manifest; apps/web/dist is
// what Capacitor wraps and the Electron renderer loads. The CSPICE WASM is large
// and lazy loaded, so it is excluded from precache to honour the 4 MB budget and
// the app-shell JS budget (.size-limit.json).
//
// The deploy target sets the public base path. Local dev, the gate (build:web), and
// the Electron/Capacitor shells all use '/'; only the GitHub Pages project-page build
// (pnpm build:pages) sets BESSEL_BASE=/bessel/ so asset URLs resolve under the subpath.
const base = process.env.BESSEL_BASE || '/';

export default defineConfig({
  base,
  resolve: {
    // Bundle @bessel/selene-design from its TypeScript source (the workspace package
    // ships no prebuilt dist). The alias is anchored to the bare specifier, so the
    // ./styles.css and ./tokens subpath exports still resolve through the package's
    // exports map. Matches the tsconfig path alias used for typechecking.
    alias: [
      {
        find: /^@bessel\/selene-design$/,
        replacement: fileURLToPath(
          new URL('../../design-system/selene-design/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        // Precache the app shell and the CSPICE wasm (code). Kernels (data) are
        // not precached: they flow through the OPFS cache in pal-web so the PWA
        // operates offline against cached kernels (SPEC Phase 2).
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Bessel',
        short_name: 'Bessel',
        description: 'SPICE-aware 3D mission visualization',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        start_url: base,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Stable, greppable chunk file names so the size-limit globs target the
        // first-paint shell (the entry app chunk + vendor) and the lazy chunks
        // separately. The entry is named app-*.js (distinct from any auto-named
        // shared "index-*" lazy chunk, so the shell glob is unambiguous). The lazy
        // panel chunks keep their source-module names (e.g. AnalysisPanel-*.js), and
        // the split analysis code lands in analysis-ops-*.js / mcs-*.js.
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        // Pin the always-loaded third-party code (the renderer and React) into one
        // vendor chunk. These are needed for first paint, so they stay eager; naming
        // them keeps the first-paint budget globs (index + vendor) stable as the app
        // grows, separate from the on-demand analysis and panel chunks.
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules')) {
            if (id.includes('/three/') || id.includes('/three-')) return 'vendor';
            if (
              /\/node_modules\/(react|react-dom|scheduler|react-resizable-panels)\//.test(id)
            ) {
              return 'vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
});
