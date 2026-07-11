---
description: Evaluate the current window's exit criteria, write honest carryover, update the re-entry brief.
---

Close (or assess) the current window against the exit criteria of
docs/design/04 section 6 (the window table). The gate is honest bookkeeping:
criteria are met by observed evidence or they carry over by name; nothing is
declared done by prose.

Steps:
1. Identify the current window and quote its exit criteria and stretch items
   from the docs/design/04 window table.
2. Evaluate each criterion against observed evidence (merged PRs, committed
   tables under docs/validation/data/, CI runs, the golden baselines, ADR
   evidence addenda). Cite the artifact, not the intention.
3. Write the honest carryover list: every unmet criterion or stretch item,
   every named finding still open, and every deferred measurement, each with
   where it lands next (a session goal, a later window, or review-on-return).
4. Run scripts/review-on-return.sh and paste the refreshed register into
   docs/collab/RE-ENTRY-BRIEF.md; record the window close in the brief's
   window-gate section with the criteria table and the carryover.
5. If the next window's goal file does not yet exist or does not absorb the
   carryover, update it now: the gate is not closed until the carryover has a
   home.
