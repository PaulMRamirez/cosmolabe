# Session 4 re-point baselines (deliberate re-baseline)

Captured 2026-07-11 under the pinned environment (environment.json: node
v22.23.1, TZ=America/Los_Angeles, the pre-merge capture parameters) from the
re-pointed renderer: the viewer and cache worker running over the frames tier
and cspice-wasm (ADR M-0002), after the Class B obliquity fix in
`cosmolabe/packages/core/src/kinematics.ts`. This sibling set is the baseline
anchor from the re-point forward; `tests/golden/pre-merge/` remains immutable
history and its tree pin is unchanged.

Attached diff against `tests/golden/pre-merge/`, stated in physical units next
to the M-0002 tolerances (1 m position, 5 arcsec pointing; render gate 0.5
percent of pixels at pixelmatch threshold 0.1): the saturn-soi numeric
fingerprint shifts by at most 0.000163 km (0.163 m) in any component, entirely
the corrected obliquity constant (84381.448 arcsec exactly, replacing a
truncated 23.4392911 degree literal); the analytical-no-spice fingerprint is
byte-identical; renders differ by 2 pixels of 786432 (0.0003 percent) on the
SOI frame and 0 pixels on the other two. No delta is attributable to the
SPICE-layer swap itself: call-parity between the retired timecraftjs wrapper
and cspice-wasm is exactly zero on all four golden scenarios
(docs/validation/data/seam-call-parity.json).

Reproduce with:

    TZ=America/Los_Angeles BASELINE_DIR=tests/golden/session-4-repoint node scripts/baseline.mjs compare

Capture refuses to target `pre-merge/` (the guard in scripts/baseline.mjs);
any future re-baseline lands in a new sibling with its own reviewed diff.
