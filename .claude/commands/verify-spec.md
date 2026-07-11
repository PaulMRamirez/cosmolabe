---
description: Adversarially cross-check the completed work against its goal and ADRs; write an HTML report.
---

Independently cross-check that the just-completed work satisfies its goal file
and the binding ADRs, from an adversarial stance: assume it is wrong until the
evidence shows otherwise. This is the reviewer of record when there is no second
human, so trust observed output, not prose. Write a self-contained HTML report.

Steps:
1. Read the goal file and every ADR it touches. Enumerate each Verified-by and
   Exit claim as a discrete, checkable assertion.
2. For each assertion, reproduce the evidence yourself: run the command, read
   the artifact, inspect the diff. Record what you actually observed.
3. Check the iron rules hold on the diff: CSPICE only under `frames`; kernels
   not committed; `authority` host-only; model-layer purity; units in SPICE km
   at the contracts; the dash sweep clean on new prose.
4. Write the report to `docs/validation/reports/<goal-slug>.html` as a single
   self-contained file: a table with one row per assertion (status pass / fail /
   n/a, the evidence, any gap), and a summary of residual risk and honest
   carryover at the top.
5. Print the report path. Do not declare the window green if any Verified-by
   assertion is unmet; surface the gap for the human gate instead.
