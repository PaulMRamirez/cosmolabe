# M-0008: Analysis surface grammar

Status: Accepted (provisional, review-on-return); demo evidence attached 2026-07-11 (Session 6)
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the grammar ratification, reviewed via live product walkthrough

## Context
Eleven engines' worth of output must surface without turning the instrument into a tabbed workbench. Full proposal: docs/design/03.

## Decision
Four product kinds map to four canonical forms: intervals to timeline lanes, series to strip charts and readouts, geometry to in-scene drapes, field to heatmap drapes with the catalog schema's named color strategies as the colorbar picker. Scene-first chrome-recessive layout; a fixed disclosure ladder (hover readout, pinned chip, lane or layer, inspector, composer overlay); the timeline as the single shared cursor. Provenance is visible grammar: the accent color appears only on computation performed here, red only on faults and alarms. The signature motion is analysis materializing from streamed partials; everything else is still. Bessel pull list tiers: P0 coverage drape, sincpt footprints, status line and log drawer; P1 porkchop inspector, conjunction and B-plane inspector, 2D ground-track inset with the MMGIS deep link.

## Consequences
Acceptance heuristics in docs/design/03 section 10 gate UI PRs. Aaron reviews live in W5-plus, not from mocks.

## Evidence addendum (Session 6, 2026-07-11)

The grammar demo runs live in the bessel web app (the Jobs tab): all four product kinds from streamed JobHandle jobs over GS-2 (access lanes with an honestly empty Sun lane, the range strip chart materializing chunk by chunk, the ground track drape) and GS-4 (a published six-plane Walker set whose 288-cell coverage field resolves row by row on Earth). Provenance is visible grammar as decided: every card carries the Computed here chip whose popover shows the product's provenance block, and the kernel set hash it displays is the compute worker's own frames-tier hash, asserted equal by the observed Playwright run (e2e/tests/grammar.spec.ts, passing in 6.4 s against the built app) which also observes the partial streaming counts and a cooperative mid-sweep cancel from the tray control. The signature motion demanded here, analysis materializing from streamed partials, surfaced one real protocol requirement during the build: worker-hosted jobs must yield macrotasks at stream boundaries or cancel messages starve, now fixed in the coverage sweep and the job runner and recorded in the Session 6 report.

Scope of this evidence, stated honestly. The demo host is a tab in the bessel workbench dock, scaffolding scheduled to dissolve into the panel shell at the packages restructure (it is inventoried as temporary wiring in the re-entry brief with that executioner). The addendum therefore evidences the grammar itself: the four kinds in their canonical forms, provenance as visible and machine-checked grammar, materialization from streamed partials, and the tray mechanics (progress, cancel). It does not evidence the scene-first chrome-recessive layout, the disclosure ladder, or the other acceptance heuristics of docs/design/03 section 10, which bind the panel shell and remain unevidenced until it exists. On the render bindings: the intervals and series forms are spine-agnostic (plain React and SVG components in @bessel/ui consuming product data, portable to any host), and the product-to-form mappers are pure functions; the geometry and field drapes are welded to bessel's SolarSystemScene (setOrbits, setCoverageOverlay), a weld also inventoried as temporary wiring, with the render-binding interface of the panel shell as its executioner. The walkthrough review on Aaron's return stands (review-on-return unchanged).
