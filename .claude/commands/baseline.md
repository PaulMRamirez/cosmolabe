---
description: Capture or compare golden renders against the immutable pre-merge baselines.
---

Drive the root baseline tool for the golden baselines of CLAUDE.md rule 5. The
committed baselines live under `tests/golden/pre-merge/` and are immutable
history; `tests/golden/pre-merge/ENVIRONMENT.md` records the pinned capture
environment and must be honored exactly.

Steps:
1. Ensure the environment matches ENVIRONMENT.md: node 22 (exact version for
   byte-for-byte claims), pnpm 9.15.0, kernels restored with
   `scripts/fetch-kernels --all`, and every invocation prefixed with
   `TZ=America/Los_Angeles` (the tool refuses to run without it).
2. To verify the baselines still reproduce (the default and almost always the
   right mode): `TZ=America/Los_Angeles node scripts/baseline.mjs compare`.
   It recaptures fingerprints and renders to a temporary directory,
   byte-compares the fingerprints, pixelmatch-compares the renders (threshold
   0.1, gate 0.5 percent), and verifies SHA256SUMS. Report the per-file
   results honestly.
3. To capture a new baseline set (only for a deliberate, reviewed re-baseline,
   for example the Session 3 re-point): never overwrite `pre-merge/`. Create a
   sibling directory under `tests/golden/`, point the capture there, and attach
   the diff against the previous baselines to the PR for review. A golden shift
   without an attached, reviewed diff is a gate failure.
4. When comparing a re-point branch, summarize deltas in physical terms
   (km of position drift, degrees of orientation drift, percent of pixels)
   next to the M-0002 tolerances, so the review reads in the units the
   contracts gate on.
