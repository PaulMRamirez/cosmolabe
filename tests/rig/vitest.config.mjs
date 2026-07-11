// Root measurement-rig vitest config (Session 2). Deliberately a plain object
// with zero imports: the repository root has no node_modules (installs are
// federated per tree), so this file must not resolve anything. The rig runs on
// the cosmolabe tree's own vitest binary, which supplies the runtime:
//
//   node cosmolabe/node_modules/.bin/vitest run --config tests/rig/vitest.config.mjs
//
// Rig specs live under tests/rig/ and import the cosmolabe test harness
// (packages/core/src/__tests__/_harness) read-only; they write captures and
// measurement tables to paths given via RIG_* environment variables. They are
// not part of the cosmolabe suite and never run under the trees' own configs.
//
// The Session 3 seam rig additionally imports the bessel seam packages
// (packages/frames, packages/cspice-wasm) by relative source path; their
// internal bare-specifier imports of cspice-wasm resolve through the aliases
// below (computed with the URL global, still zero imports). Order matters:
// the wasm subpath must match before the bare package name, or the prefix
// rewrite would mangle it.
const bessel = (rel) => new URL(`../../bessel/${rel}`, import.meta.url).pathname;

export default {
  resolve: {
    alias: [
      {
        find: 'cspice-wasm/wasm/cspice.mjs',
        replacement: bessel('packages/cspice-wasm/wasm/cspice.mjs'),
      },
      { find: 'cspice-wasm', replacement: bessel('packages/cspice-wasm/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/rig/**/*.rig.ts'],
    // Scene builds furnish SPICE kernels; allow the same headroom the
    // heritage golden test allows. The seam rig loads two SPICE stacks and an
    // 8 MB cruise kernel on top of that.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
};
