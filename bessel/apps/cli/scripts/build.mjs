// Build the bessel CLI to a single runnable Node binary at dist/main.js.
//
// Strategy: esbuild bundles src/main.ts plus all @bessel/* workspace sources
// (their package "exports" point at .ts) into one ESM file targeting Node 22,
// with the shebang preserved. The CSPICE-WASM Emscripten loader is the one piece
// we must NOT inline: it resolves cspice.wasm relative to its own import.meta.url
// at runtime. So we keep cspice-wasm/wasm/cspice.mjs external, rewrite the
// import to a sibling ./cspice.mjs, and copy both cspice.mjs and cspice.wasm next
// to dist/main.js. Node built-ins and third-party packages stay external and are
// resolved from node_modules at runtime. Fails loudly on any build error.

import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = resolve(root, 'dist');
const wasmDir = resolve(root, '../../packages/cspice-wasm/wasm');

// Keep the Emscripten loader external and point it at a sibling file in dist so
// its import.meta.url based wasm lookup resolves cspice.wasm next to main.js.
const externalizeWasmLoader = {
  name: 'externalize-cspice-wasm-loader',
  setup(b) {
    b.onResolve({ filter: /\/wasm\/cspice\.mjs$/ }, () => ({
      path: './cspice.mjs',
      external: true,
    }));
  },
};

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await build({
    entryPoints: [resolve(root, 'src/main.ts')],
    outfile: resolve(distDir, 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    // src/main.ts already begins with `#!/usr/bin/env node`; esbuild preserves a
    // leading shebang, so do not add a banner (that would duplicate it).
    // @bessel/* workspace sources are .ts and get inlined; node built-ins and any
    // third-party dependency stay external and resolve from node_modules.
    plugins: [externalizeWasmLoader],
    external: ['node:*'],
    logLevel: 'info',
  });

  await copyFile(resolve(wasmDir, 'cspice.mjs'), resolve(distDir, 'cspice.mjs'));
  await copyFile(resolve(wasmDir, 'cspice.wasm'), resolve(distDir, 'cspice.wasm'));
}

main().catch((err) => {
  console.error('build:cli failed:', err);
  process.exit(1);
});
