import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve every @bessel/* workspace package to its TypeScript src entry, anchored
// to the bare specifier so subpath exports (e.g. @bessel/spice/wasm/...) still flow
// through each package's exports map. The workspace ships no prebuilt dist (notably
// @bessel/selene-design under design-system/), so without these aliases the renderer
// production build resolves a non-existent dist the moment @bessel/ui pulls a selene
// component. This mirrors the web vite/vitest aliasing (kept in sync deliberately).
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const srcEntry = (dir: string): string => resolve(repoRoot, dir, 'src/index.ts');
const besselAliases: { find: RegExp; replacement: string }[] = [
  { find: /^@bessel\/selene-design$/, replacement: srcEntry('design-system/selene-design') },
];
for (const name of readdirSync(resolve(repoRoot, 'packages'))) {
  besselAliases.push({
    find: new RegExp(`^@bessel/${name}$`),
    replacement: srcEntry(`packages/${name}`),
  });
}

// electron-vite project: main, preload, renderer. The preload exposes the typed
// IPC surface pal-electron consumes (Phase 1 fills it). The renderer reuses the
// shared React UI; in a later phase it loads apps/web/dist directly for parity.
export default defineConfig({
  main: {
    // Bundle the workspace packages (TS source) into main; only externalize real
    // node_modules so out/main is runnable without the monorepo source tree.
    plugins: [externalizeDepsPlugin({ exclude: ['@bessel/pal-electron', '@bessel/pal'] })],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
    },
  },
  preload: {
    // Sandboxed preloads must be CommonJS, so emit preload.cjs.
    plugins: [externalizeDepsPlugin({ exclude: ['@bessel/pal-electron', '@bessel/pal'] })],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.cjs',
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: besselAliases },
    plugins: [react()],
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
});
