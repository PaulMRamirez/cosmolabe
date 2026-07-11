---
description: Run the differential harness and summarize deltas against the M-0002 gates.
---

Drive the seam gate of CLAUDE.md rule 3 and ADR M-0002: both SPICE paths,
cosmolabe's timecraftjs-based `@cosmolabe/spice` and the cspice-wasm layer
behind the `@cosmolabe/frames` contracts, over the GS-1 and GS-2 fixtures with
identical kernel bytes. The rig is `tests/rig/seam.rig.ts`; the delta tables
land in `docs/validation/data/seam-call-parity.json` and `seam-pipeline.json`.

Steps:
1. Ensure kernels are restored (`scripts/fetch-kernels`; the GS-1 cruise kernel
   is in the manifest) and cosmolabe dependencies are installed (the rig runs
   on cosmolabe's vitest binary).
2. Run `TZ=America/Los_Angeles node scripts/seam.mjs` (the tool refuses to run
   without the pinned zone). It runs the rig, prints both tables, and
   summarizes each against its gate.
3. Read call-parity against relative 1e-12: every row must pass. A red row is
   a seam-gate failure; nothing touching cspice-wasm, frames, or core state
   paths merges over it, and the fix is never a tolerance change (any
   tolerance change reopens M-0002).
4. Read pipeline mode against the tripwires, 1 m position and 5 arcsec
   pointing. These are recorded, not asserted: they gate the re-point, not the
   current session. Report rows outside the tripwires honestly, with the named
   finding from the table description; `--strict-pipeline` turns them into an
   exit failure (the re-point mode, Session 4 onward).
5. Summarize deltas in physical terms (relative parity, meters of position,
   arcseconds of pointing) next to the gates, and cite the kernel set hashes
   the tables carry so the run is reproducible against the same bytes.
