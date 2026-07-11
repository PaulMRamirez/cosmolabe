# ADR-0013: Selene design system as a sanctioned leaf presentation tier

Status: Accepted
Date: 2026-06-20

## Context

The app is reskinned to the selene design system (design-system/selene-design).
Selene is a leaf presentation package: it declares only react and react-dom as peer
dependencies and imports nothing from Bessel core, the PAL interface, the UI layer,
or the shells. It exports oklch CSS tokens, typed token JS (tokens as var() refs and
tokenValues as raw oklch via the "./tokens" subpath), and small React leaf components
(Button, Metric, TeleCell, Gauge, MiniBar, StatusDot, Tag, EventRow, AssetRow,
SectionLabel, Divider). The shells already depend on it legitimately: apps/web lists
it and generic-mission.ts consumes its tokenValues.

We now want the live telemetry readout (packages/ui/src/TelemetryOverlay.tsx, in
@bessel/ui) to use selene data-display components (StatusDot, TeleCell, Gauge,
Metric) so the shared telemetry chrome matches the rest of the reskinned app, and we
want a selene StatusDot glyph in the apps/web status HUD. The HUD change is app
layer and needs no decision. The TelemetryOverlay change does: it introduces a
@bessel/ui to @bessel/selene-design import edge. The layering rule in CLAUDE.md
enumerates the dependencies of each tier and does not yet list selene as one the UI
tier may import, so the edge is unsanctioned by that list even though it is
directionally safe. The rule exists to stop two real hazards: the core importing a
concrete PAL, and lower layers importing higher shells. A UI to leaf-presentation
edge is neither; selene sits below UI directionally, exactly like @bessel/color,
which @bessel/ui already imports, so no cycle is possible. Nothing mechanical
currently enforces layering (no eslint boundaries or import plugin, no
dependency-cruiser, no import-graph test); the only workspace guard counts packages/
and apps/ and ignores design-system/, so the edge passes the gate either way. The
boundary is therefore review-enforced, which is exactly why the edge must be
recorded.

## Decision

1. We classify @bessel/selene-design as a sanctioned leaf presentation tier that
   sits below the UI tier. The UI tier and the core-tier packages may import it; the
   shells may import it (they already do). The dependency is declared with
   "@bessel/selene-design": "workspace:*" in the importing package, starting with
   packages/ui/package.json.
2. Selene must remain a pure leaf: it may import only react and react-dom (peer) and
   must import nothing from Bessel core, the PAL interface, the UI layer, or the
   shells. This invariant is binding and, until a boundaries lint or import-graph
   test lands, is enforced by review, not by the build gate; that enforcement gap is
   the explicit residual risk of this decision.
3. This grant does not loosen the rest of the layering rule. Core analysis packages
   still must not import a PAL, and nothing may import a shell. "Leaf below UI" names
   a presentation tier only; it is not a license to cross any other boundary.

## Consequences

- Shared UI (TelemetryOverlay and future components) can speak the selene
  data-display vocabulary directly, so every shell that renders them gets one
  coherent look without per-shell wiring.
- The dependency graph stays acyclic: selene cannot import UI, so the edge cannot
  cycle; it is directionally identical to the existing @bessel/color edge.
- The leaf invariant becomes load-bearing; a future change that makes selene import
  anything from Bessel would silently break the tier model, and the gate would not
  catch it, so reviewers must guard it (and a boundaries lint should be added later).
- The CLAUDE.md and docs/architecture.md layering descriptions are now slightly
  behind this ADR; they are not edited during a feature goal, so this ADR is the
  source of truth for the new edge until they are refreshed deliberately, alongside a
  docs/PARITY_MATRIX.md note.
- The workspace package count is unaffected: selene-design stays under design-system/
  (not packages/), so the 27-package, 4-app metadata guard remains green; only a
  dependency line is added to an existing package.
