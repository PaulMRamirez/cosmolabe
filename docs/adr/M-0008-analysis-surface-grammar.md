# M-0008: Analysis surface grammar

Status: Provisional (ratified for build in W3; review-on-return via live product walkthrough)
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; the grammar ratification, reviewed via live product walkthrough

## Context
Eleven engines' worth of output must surface without turning the instrument into a tabbed workbench. Full proposal: docs/design/03.

## Decision
Four product kinds map to four canonical forms: intervals to timeline lanes, series to strip charts and readouts, geometry to in-scene drapes, field to heatmap drapes with the catalog schema's named color strategies as the colorbar picker. Scene-first chrome-recessive layout; a fixed disclosure ladder (hover readout, pinned chip, lane or layer, inspector, composer overlay); the timeline as the single shared cursor. Provenance is visible grammar: the accent color appears only on computation performed here, red only on faults and alarms. The signature motion is analysis materializing from streamed partials; everything else is still. Bessel pull list tiers: P0 coverage drape, sincpt footprints, status line and log drawer; P1 porkchop inspector, conjunction and B-plane inspector, 2D ground-track inset with the MMGIS deep link.

## Consequences
Acceptance heuristics in docs/design/03 section 10 gate UI PRs. Aaron reviews live in W5-plus, not from mocks.
