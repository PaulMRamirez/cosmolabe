# Goal: a natural cross-perspective flow for the deep analysis capabilities

Status: proposed (awaiting human decisions on the open questions in section 7).
Source: the `analysis-ux-design` workflow (5 user-perspective agents + a current-UI
audit, a senior-UX synthesis, and an adversarial persona-flow critique).

## 1. North star (the completion criterion)

Each Bessel analyst perspective has a NATURAL flow from their use cases through the
UI: a clear entry, minimal configured steps, interpretable results linked to the 3D
scene and timeline, and a compare/export/decide close, all without leaving the
Analyze workbench, and with the deep (today engine-only) capabilities surfaced as
parameters and toggles on intent-named tasks rather than as a flat wall of buttons.

The goal is met when the per-perspective acceptance criteria in section 4 pass and
the gate in section 6 is green.

## 2. Design philosophy

Surface depth through TASK FRAMING, not tool enumeration. Every analysis is an
instance of one universal pattern, and the previously engine-only capabilities
(full-covariance Pc, B-plane, beta angle, az/el mask, sun-exclusion, terrain LOS,
range-rate, revisit/area-weighted FOM, antenna/polarization/rain-noise, modcod
margin) become PARAMETERS on configurable, intent-named tasks. We re-slot and
parameterize the existing AnalyzeWorkbench, lazy-ops seam, store slices, ResultView,
Compare tray, and camera-relative scene overlays; we do not rebuild them.

## 3. Information architecture

Hybrid, workflow-first within a shared scenario frame. Intent-named domain tabs, each
owning the engines that compose for one analyst's inner loop; a shared Scenario
object set every domain reads.

Domain tabs (extend the existing tablist; keep the role=tab/roving-tabindex machinery):
1. Orbit & Maneuver (folds in OD per the decision in 7): user TLE/state propagation
   with SGP4-vs-HPOP overlay, editable MCS builder + differential corrector,
   configurable Lambert + porkchop.
2. Lighting & Geometry: beta-angle season series; eclipse umbra/penumbra/annular/
   sunlit + solar-intensity; ground track; sub-point; range.
3. Access & Comms: composable constraint-stack access (LOS / az-el mask /
   sun-exclusion keepout / range / range-rate / terrain LOS), station passes, in-FOV
   observation windows with selectable pointing mode, the link-budget worksheet over
   real pass geometry, Doppler/range-rate.
4. Conjunction: all-vs-all screening over an ingested catalog with triage, per-event
   full-covariance Pc + Max-Pc, B-plane viewer, covariance-to-TCA, watchlist.
5. Coverage & Constellation: Walker/custom designer that renders AND feeds the sweep;
   region/global grid with metric + N-fold + mask; metric-aware contour with legend;
   FOM summary table.
6. Report and Compare remain cross-cutting sinks.

Within a tab, tools are collapsible TaskCards (intent name, one-line purpose, status
chip, config form, run, inline result, Keep/Export), at most two expanded by default.
A top-of-dock AnalysisLauncher search ("what do you want to analyze?") filters cards
across tabs and jumps to the owning card.

## 4. The universal natural flow + per-perspective acceptance

Flow stages: Scenario/Context -> Choose -> Configure -> Run -> Interpret & Visualize
(inline result + "Show in scene" / "Scrub to event") -> Compare/Export/Decide.

Acceptance criteria (testable):
- Trajectory designer: paste own TLE in the context bar and see an SGP4-vs-HPOP
  overlay in <=3 steps (no SAMPLE_TLE); build a 4+-segment MCS, run the corrector,
  watch residuals converge, solved arc drawn in 3D, all in one tab.
- Comms engineer: from picking a ground station to a margin-vs-time plot over real
  az/el-masked passes with the required-Eb/N0 threshold drawn, in <=5 steps; read and
  CSV-export an itemized line-by-line link budget at worst-case and nominal elevation.
- SSA analyst: screen an ingested catalog with configurable thresholds on a
  cancellable worker, get a Pc-colored sortable table, click an event, see a B-plane
  plot (1/3-sigma ellipse, miss vector, hard-body circle, RIC); input a per-object
  covariance, STM-propagate to the common TCA, get full-covariance Pc + Max-Pc.
- Coverage planner: design a Walker constellation that renders as rings AND becomes
  the asset set; sweep a region with a selected FOM metric and N-fold k; read a
  metric-aware contour with a legend and a region FOM summary, in one tab.
- Observation planner: in-FOV windows for a selectable pointing mode with a toggled
  constraint stack (keepout + az/el mask), showing FOV-only vs post-constraint
  surviving windows with a per-constraint breakdown, FOV + sun-keepout cones in 3D.
- Cross-cutting: set span/step/target/observer/frame/spacecraft-source/station once
  in the context bar and it changes every relevant tool, with zero per-tool
  span/step/target duplicates and no "use shared context" checkboxes; every result
  shows units + a threshold/pass-fail/risk framing and a "Show in scene" control; any
  result can be Kept and compared side by side.

## 5. Committed fixes from the critique (not optional)

1. Scenario Object Model: replace flat single-selects with a typed scenario slice of
   ROLE SLOTS (primary spacecraft, secondary object(s), active station(s), observation
   target, asset SET). Cards read by role. Without this the "set context once" promise
   breaks for conjunction (primary+secondary+covariance), coverage (asset set), comms
   (spacecraft+station), and observation (target+instrument+station).
2. First-class cross-tab carriers (specified now, wiring gated to P2): OD covariance
   -> Conjunction covariance source; Lambert/MCS solved-or-candidate burn ->
   Conjunction avoidance rescreen and back. Explicit "send X to Y" writing to the
   scenario model, not a bare "jump to tab".
3. Intra-tab active-selection bindings: Link Worksheet binds to a SELECTED pass row;
   Slew Feasibility binds to two SELECTED consecutive windows. A lightweight
   "active selection" on the producing card the consuming card reads.
4. SSA data ingestion committed in v1 (DECIDED, section 7): wire the REAL ingestion
   path now: parseCdm -> per-object covariance, parseOem -> secondary ephemerides,
   TLE sets, through the PAL KernelSource, validated against fixtures. The conjunction
   persona operates on real data from the first cut.
5. Overload cap: hold the tablist at <=6 (fold OD into Orbit & Maneuver per 7);
   at-most-two-expanded enforced in TaskCard state; ship the AnalysisLauncher search
   in Phase 0 BEFORE new capability; pull the Observation multi-target schedule from
   P3 up to P2.

## 6. Gate (completion check)

- `pnpm verify` (typecheck, lint, test, build:web, size) green, with the per-chunk
  size budgets UNCHANGED (every new panel React.lazy, every op behind
  `import('./analysis-ops.ts')`; no first-paint shell regression).
- `pnpm e2e` green: the WebGL-frame render test and the axe a11y scan stay green; tab
  keyboard nav (ArrowLeft/Right, roving tabindex, role=tab/tabpanel) preserved on the
  new tab set.
- Each acceptance criterion in section 4 has a passing unit or e2e assertion.

## 7. Decisions (resolved 2026-06-21)

1. Tab budget: FOLD OD into Orbit & Maneuver; the tablist stays at <=6.
2. Persona lens: include lightweight MISSION-PROFILE PRESETS (open a persona's home tab
   + pre-expand their cards) as a P1 accelerator layered over the workflow IA, not a
   separate mode. Phase 0 ships the pure workflow IA + search; presets follow.
3. SSA ingestion: WIRE REAL CCSDS CDM/OEM + TLE-set ingestion now (Phase 1), through
   the PAL KernelSource, against fixtures. Not a bounded-fixture stopgap.
4. Export: BUILD A UNIFIED "export this analysis" / report builder up front (Phase 0/1
   foundation), replacing the fragmented per-card CSV/OEM/CDM paths.

## 8. Phasing (locked to the section 7 decisions)

- Phase 0 (re-slot + scaffold, no new engine capability): the Scenario Object Model
  slice + context-bar role controls; the TaskCard accordion + status chips; the
  AnalysisLauncher search; the 6-tab domain regroup with OD folded into Orbit &
  Maneuver; and the UNIFIED export path foundation (one "export this analysis" surface
  the per-card exports route through). Removes the flat-button-list regression and the
  hardcoded-input/duplicate-param frictions.
- Phase 1 (P0 surfacing): editable TLE/state propagation (SGP4-vs-HPOP) + MCS builder +
  corrector; the Conjunction tab including REAL CDM/OEM/TLE ingestion -> screen ->
  per-event full-covariance Pc + B-plane; the access constraint-stack + in-FOV pointing
  mode; beta/eclipse/solar-intensity; the Walker -> sweep -> metric-aware contour
  workflow. Mission-profile presets land here as the accelerator layer.
- Phase 2 (P1 + carriers): link worksheet + modcod margin + loss group; ground-station
  registry + az/el-mask passes; Lambert porkchop; the first-class cross-tab carriers
  (OD covariance -> Conjunction, MCS burn -> rescreen) and intra-tab active-selection
  bindings; whole-variant Compare; covariance input.
- Phase 3 (P2 hardening): terrain-LOS toggle; maneuver-then-rescreen loop + watchlist;
  worker sweeps for coverage/porkchop; selectable ground-track projections; the
  Observation multi-target schedule (pulled up from P3 per the critique).
