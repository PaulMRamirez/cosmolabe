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
export default {
  test: {
    include: ['tests/rig/**/*.rig.ts'],
    // Scene builds furnish SPICE kernels; allow the same headroom the
    // heritage golden test allows.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
};
