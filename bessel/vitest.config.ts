import { defineConfig } from 'vitest/config';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcEntry = (rel: string) => fileURLToPath(new URL(`./${rel}/src/index.ts`, import.meta.url));

// Anchored aliases generated from the workspace: every @bessel/* package (and the
// design-system leaf, which lives under design-system/ and ships no dist) is rewritten
// to its src entry, so no package silently diverges onto exports/dist resolution once
// its build output differs from its source. Only the bare specifier is rewritten;
// subpath imports (for example @bessel/spice/wasm/cspice.mjs) fall through to node
// resolution via each package's exports map. Kept in sync with the web vite and the
// electron-vite renderer aliasing.
const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));
const alias: { find: RegExp; replacement: string }[] = [
  {
    find: /^@bessel\/selene-design$/,
    replacement: srcEntry('design-system/selene-design'),
  },
];
for (const name of readdirSync(packagesDir)) {
  alias.push({ find: new RegExp(`^@bessel/${name}$`), replacement: srcEntry(`packages/${name}`) });
}

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.{ts,tsx}', 'apps/**/src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'vendor/**', 'e2e/**'],
    benchmark: {
      include: ['packages/**/*.bench.ts'],
    },
  },
});
