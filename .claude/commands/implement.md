---
description: Implement the current window's goal file end to end, self-verifying against the gate.
---

Given a goal file (an argument, or the newest `docs/goals/SESSION-*.goal.md`),
implement it end to end on a dedicated branch and worktree. One workstream per
branch; the WIP limit is two concurrent workstreams.

Steps:
1. Read the goal file's Steps, Verified-by, and Exit sections, and read
   `CLAUDE.md`: the iron rules bind every change in the session.
2. Implement the Steps with mechanically minimal diffs. Any improvement to
   cosmolabe-heritage code beyond what a step requires goes in a separate
   `/baseline` PR, not here (rule 2). Do not opportunistically refactor.
3. Self-verify with `/verify` until green. Keep kernels out of git (rule 7);
   keep `authority: 'host'` host-only (rule 4); nothing above `frames` calls
   CSPICE (rule 1); model-layer purity holds (rule 6); no dashes in prose
   (rule 10).
4. Satisfy every Verified-by clause with observed evidence, then perform the
   Exit deliverables (including writing or updating the next goal file).
5. Open a PR once the gate is green.
