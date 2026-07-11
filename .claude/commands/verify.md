---
description: Run the merged repository's unified verification gate and report honestly.
---

Run the single gate for the merged monorepo and report results stage by stage.

Steps:
1. If a tree's dependencies are missing, install them first: bessel with
   `pnpm -C bessel install --frozen-lockfile`, cosmolabe with
   `npm --prefix cosmolabe ci`.
2. From the repository root, run `pnpm verify`. In order it runs:
   `scripts/fetch-kernels` (populates the gitignored SPICE kernels the spice
   tests read, verified against sha256), then bessel's gate (typecheck, lint,
   test, build:web, size), then cosmolabe's build and tests.
3. Report pass or fail per stage. On failure, show the failing output and stop;
   never paper over a red stage.

Do not weaken tolerances, skip or `.skip` tests, or add a new `ts-ignore` or
`eslint-disable` to force green (CLAUDE.md rule 5 and the harness discipline).
The gate must pass before any PR merges.
