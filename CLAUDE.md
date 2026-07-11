# CLAUDE.md

This repository is the merge of Bessel (browser-native astrodynamics engines, SDK, CLI, delivery infrastructure) and Cosmolabe (visualization engine) into one product built from reusable packages. Cosmolabe is the product and the visible instrument; Bessel is the compute identity (engine packages, SDK, and the `bessel` CLI binary). Rationale lives in `docs/design/`, decisions in `docs/adr/`; this file is the operating constitution for agent sessions and stays short.

## Iron rules

1. Nothing above the `frames` tier calls CSPICE directly. All state and orientation flows through the `StateProvider` and `FramesService` contracts (ADR M-0002). The `correction` field is explicit at every call site, never defaulted.
2. Re-point diffs are mechanically minimal. Any improvement to cosmolabe-heritage code beyond what the SPICE re-point requires goes in a separate PR with a `/baseline` diff attached. Do not opportunistically refactor the renderer.
3. The differential harness gates the seam. Nothing touching `cspice-wasm`, `frames`, or core state paths merges unless `/seam` is green against the M-0002 tolerances (call-parity: relative 1e-12; pipeline: 1 m position, 5 arcsec pointing).
4. `authority: 'host'` is set only by host data adapters. Engines emit `'exploratory'`. No exceptions, including demos.
5. Visual changes require a golden-image pass. Baselines live under `tests/golden/`; `tests/golden/pre-merge/` is immutable history.
6. Model-layer purity is lint-enforced: no Svelte, React, or DOM imports in `core`, `frames`, or `engines/*`.
7. Kernels are never committed. `scripts/fetch-kernels` populates a checksummed pack-min cache; CI uses the same path.
8. Every architectural decision becomes an ADR in `docs/adr/`. Decisions Aaron has not seen carry a dedicated `Review-on-return: yes` line; scripts/review-on-return.sh emits the register (see `docs/collab/mandate.md` for the delegation).
9. Units are SPICE kilometers at the contracts; conversions happen at the render boundary and are documented where they happen.
10. Documentation style: dense prose, minimal bullets, and no em dashes or en dashes anywhere in any file, including comments and commit messages. Use commas, colons, parentheses, or semicolons.

## Conventions

pnpm workspaces; the unified gate is `pnpm verify` (build, lint, tests, size limits) and it must pass before any PR merges. Conventional commits with package scope, for example `feat(frames): add chain inspection`. One workstream per branch and worktree; WIP limit is two concurrent workstreams. Sessions run `/model fable`. Dynamic workflows require Claude Code v2.1.154+.

## Commands

Inherited from the bessel harness: `/phase`, `/verify`, `/implement`, `/verify-spec` (adversarial cross-check, writes the HTML report). Merge-specific, in `.claude/commands/`: `/seam` (run the differential harness, summarize deltas against gates), `/baseline` (capture or compare golden renders), `/adr` (draft an ADR with correct status vocabulary), `/gate` (evaluate the current window's exit criteria, write honest carryover, update the re-entry brief). The per-window rhythm: goal file in, `/implement`, `/verify-spec`, human reads the report and the gate.

## Map

`docs/design/01` is the merge review (verdict and amendments), `02` is the go-forward plan (contracts as TypeScript, tiers, profiles, kernel logistics), `03` is the analysis surface design review (the four-form grammar). `docs/adr/` holds M-0001 through M-0010. `docs/collab/` holds the working agreement and the living re-entry brief. `docs/validation/` is the source of the public validation report page. Old pre-merge phase goals are archived under `docs/goals/archive/` and do not describe this program.
