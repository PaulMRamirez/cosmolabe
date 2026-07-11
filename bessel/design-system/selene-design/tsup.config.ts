import { defineConfig } from 'tsup';

// Compiles src/index.ts → dist/ as ESM + .d.ts. React is a peer (external).
// CSS + font assets are NOT bundled here — they ship straight from src/ via the
// package `exports` map ("./styles.css", "./tokens/*"), so url() font paths stay intact
// and your app's bundler (Vite/Workbox) fingerprints + precaches them.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
