# M-0012: cspice-wasm moves to its own repository

Status: Accepted
Date: 2026-11-20 | Deciders: Paul Ramirez
Review-on-return: yes; the package leaves the monorepo, and the purity audit and the bessel package count each lose one entry

## Context
cspice-wasm was extracted inside this repository in Session 3 (ADR M-0002) as an internally published package with a reserved npm name, and by design it depends on nothing else in the workspace. Interest in it now reaches beyond Cosmolabe: it is the full-CSPICE reference for ground tooling around onboard WebAssembly sequencing (a kernel slicer and a validator for a small flight-side geometry library), and those consumers should not have to depend on, or clone, an application monorepo. That is the neutral-scope principle of M-0005 applied to the one package that is already neutral in fact. Spice paths are Paul's under the CODEOWNERS mapping of M-0006.

## Decision
The package lives at github.com/PaulMRamirez/cspice-wasm. Its history was split out intact (the `bessel/packages/cspice-wasm` commits, the earlier `packages/spice` ancestry, and the kernel fixtures its tests read); the split tree is byte-identical to the monorepo package at `c5debc5`. This repository deletes `bessel/packages/cspice-wasm` and consumes the package as a git dependency pinned to a commit on its main branch, in the five bessel packages that depended on it; the pin moves to a version range once 0.1.0 is published to npm. `@bessel/spice` remains as the facade, and iron rule 1 is unchanged: nothing above the frames tier calls CSPICE.

Call-site code does not change. The re-point is confined to resolution: dependency specifiers and the lockfile, the tsconfig paths, the rig aliases and the cosmolabe postinstall link (both now target the copy the bessel workspace installs for the frames tier), the CLI build's wasm directory, and the nightly Horizons workflow, which now installs the bessel workspace because the rig can no longer reach cspice-wasm by source path.

## Consequences
Consumers here resolve the package's built `dist` instead of its TypeScript source, so a change to cspice-wasm is a two-step: merge there, then move the pin here, and the seam harness (iron rule 3) judges the pin move. The twelve cspice-wasm test files run in that repository's CI, not this one; the bessel package count drops from 31 to 30, and the purity audit no longer lists the package (it has no runtime dependencies, and its purity is that repository's concern). The WASM build script and its CSPICE source pin move with the package; `pnpm cspice:build` is gone from the bessel scripts. The kernel fixtures stay here as well, since other bessel packages read them, so the two copies can drift; the standalone repository owns the generators. Publishing to npm is a separate decision that waits on a read of NAIF's redistribution terms.
