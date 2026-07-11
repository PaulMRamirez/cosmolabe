# The Analysis Workbench

A guide to Bessel's consolidated analysis dock: how it is organized, the universal
flow every analysis follows, and the controls that tie the whole thing together.
For the per-perspective walkthroughs (mission designer, comms engineer, SSA
analyst, coverage planner, observation planner) see docs/analysis-personas.md. For
the engine behind each card (inputs, math, validation) see docs/analysis-tools.md.

## What the workbench is

The workbench is the right-dock "Analyze" panel (`data-testid="analyze-workbench"`).
It is pinnable and tabbed; unlike a popover it does not auto-dismiss, so results
survive canvas clicks, timeline scrubbing, and tab switches. Each tab reads its
result from the store, so switching tabs re-renders from state with no recompute.
Closing the dock returns the width to the 3D canvas.

The tab bodies are lazy-loaded, so opening the dock for the first time does not
grow the first-paint shell; the analysis engines themselves load behind a dynamic
import on first use.

## Design philosophy: task framing, not a tool list

The workbench surfaces depth through TASK FRAMING rather than a flat wall of
buttons. Every analysis is an instance of one universal pattern, and the deeper
capabilities (full-covariance Pc, B-plane, beta angle, az/el mask, sun keepout,
terrain line of sight, range rate, area-weighted figure of merit, modcod margin)
are parameters and toggles on intent-named tasks, not separate top-level tools.

Three ideas follow from this:

- Tools are grouped by the analyst's intent into six domain tabs, each owning the
  engines that compose for one inner loop.
- A shared Scenario context (spacecraft source, ground stations, target, span,
  frame) is set once and read by every relevant task; there are no per-tool
  "use shared context" checkboxes and no duplicated span/step/target fields.
- Each tool is a collapsible TaskCard with an intent name, a one-line purpose, a
  status chip, a config form, a run button, and an inline result you can Keep or
  Export.

## The six domain tabs

The tablist (`role="tablist"`, ArrowLeft/ArrowRight roving) holds exactly six tabs.
Each tab opens at most two TaskCards by default to avoid overload.

### 1. Orbit & Maneuver (`tab-orbit-maneuver`)

Trajectory design and maneuver planning, with orbit determination folded in. Cards:

- Propagate orbit (SGP4 / HPOP): propagate the scenario spacecraft source and read
  altitude plus ground track; SGP4 against the numerical HPOP integrator (selectable
  force model) for an altitude overlay.
- Mission control sequence: build and run an editable MCS (an ordered list of
  InitialState / Propagate / Maneuver / Target segments) with a differential
  corrector; residuals converge and the solved arc draws in 3D.
- Orbit determination: a batch least-squares fit with residual RMS and a covariance
  summary.
- Attitude slew: an eigen-axis slew profile between two pointing modes.
- Lambert transfer + porkchop: sweep a departure x time-of-flight delta-v contour on
  a worker, mark the minimum, and send the best transfer to the MCS.

### 2. Lighting & Geometry (`tab-lighting-geometry`)

Geometry and lighting season analysis. Cards:

- Range to a target: spacecraft-to-target distance over the span.
- Ground track: the sub-spacecraft longitude/latitude track, with a selectable
  projection (equirectangular / Web Mercator / polar stereographic) and the scenario
  ground stations draped as overlay markers in the same projection.
- Beta-angle season: the solar beta angle over the span against the eclipse-onset
  threshold.
- Eclipse phases: umbra / penumbra / annular / sunlit windows plus per-day duration.
- Solar intensity: the visible solar-disk fraction (0..1) for power and thermal.

### 3. Access & Comms (`tab-access-comms`)

Visibility, ground-station passes, and the link budget. Cards:

- Constraint-stack access: the surviving spacecraft-to-target window under a
  composable constraint stack (line of sight, az/el mask against the active station,
  sun-exclusion keepout, range, range rate, terrain line of sight), with a
  per-constraint breakdown of what each constraint alone admits.
- In-FOV observation windows: when a target falls within the active sensor FOV for
  the selected pointing mode, shown FOV-only and post-constraint (intersected with
  the access stack).
- Downlink budget: Eb/N0 over the pass for a configured radio link.
- Station passes: rise/set passes over the active station (az/el mask) with
  max-elevation per pass; rows are selectable to bind the worksheet, and a
  consecutive pair feeds the slew check.
- Link-budget worksheet: the itemized line-by-line budget at the worst-case and
  nominal elevation of the selected pass, with the modcod margin, a margin-vs-time
  chart with the link-closes threshold drawn, and a CSV.
- Slew feasibility: does the eigen-axis slew between two selected consecutive passes
  fit the gap?
- Observation multi-target schedule: a conflict-free, slew-feasible observation
  timeline across a target list, with the unscheduled targets and their reasons.

### 4. Conjunction (`tab-conjunction`)

Conjunction screening and risk assessment over real ingested data. Cards:

- Catalog ingestion & screening: ingest a pasted CCSDS CDM, CCSDS OEM, or a TLE set
  (a per-format "Load sample" button supplies a runnable document), then run an
  all-vs-all screen over that real catalog on a cancellable worker with configurable
  threshold and sieve pad.
- Per-event Pc & B-plane: a Pc-colored, sortable table of screened events; clicking a
  row computes the full-covariance Pc plus the Max-Pc (Alfano) bound and renders the
  encounter-plane (B-plane) plot, with a covariance-input form when the catalog
  carried none, a "Plan avoidance burn" carrier into the MCS, a "Screen after
  maneuver" before/after Pc, and a CDM export.
- Watchlist: the tracked pairs, each with its current Pc and miss and a rose/fell
  trend chip that updates on re-screen or covariance input.
- Closest approach (pair): miss distance, TCA, relative speed, and Pc for a single
  loaded pair.

### 5. Coverage & Constellation (`tab-coverage`)

The connected designer-to-sweep workflow. Cards:

- Walker constellation: design a Walker T/P/F constellation; it renders as orbit
  rings and publishes its members as the swept asset set.
- Coverage sweep: sweep a coverage figure-of-merit grid over the asset set on a
  dedicated worker (live cells-done readout and cancel), coloring a metric-aware
  contour with a legend and a regional FOM summary table with CSV.

### 6. Report & Compare (`tab-report-compare`)

The cross-cutting sinks. Cards:

- Data-provider report: run an EvalSpec provider over an observer/target pair, frame,
  and time grid, returning a unit-tagged table and CSV.
- Export trajectory (OEM): download the spacecraft trajectory as a CCSDS OEM.
- Compare kept results: tabulate the kept snapshots side by side (grouped by domain)
  with the predicted-versus-actual telemetry overlay.

## The universal flow

Every analysis follows the same six stages:

1. Scenario / Context: set the shared context once in the context bar.
2. Choose: pick a task, by opening its tab and TaskCard, by searching the launcher,
   or by clicking a mission-profile preset.
3. Configure: fill the card's parameters (every deep capability is a parameter or a
   toggle here).
4. Run: press the card's primary action; long sweeps run on a worker with progress
   and cancel.
5. Interpret & Visualize: read the inline result (units, a threshold or pass/fail or
   risk framing, a chart/table/timeline) and its scene/timeline link.
6. Compare / Export / Decide: Keep the result into the compare tray, export a CSV (or
   OEM/CDM), and decide.

## The Scenario context bar

The context bar (`analysis-context-bar`) sits at the top of the dock and drives every
tab by default; a tab may override locally. It is the Scenario Object Model made
visible: typed ROLE SLOTS the tasks read by role, not flat per-tool single-selects.

- Epoch and time system: the live timeline epoch shown read-only with its UTC/TDB tag
  (`ctx-epoch`), so every tool already shares the run epoch. Toggle UTC vs TDB.
- Span (days) and Step (s): the analysis window and search step (`ctx-span-days`,
  `ctx-step-sec`).
- Target and Observer: the default target/observer for the geometry tasks
  (`ctx-target`, `ctx-observer`), chosen from the loaded objects.
- Frame: a common SPICE frame or a custom frame name (`ctx-frame`,
  `ctx-frame-custom`); a free entry is allowed and fails loudly at run time.
- Ground stations (`station-registry`): the first-class station registry. Add a
  station (name, lon, lat, alt, min-elevation mask in degrees), select the active one,
  or remove it. The access/comms tasks read the ACTIVE station by role.

The spacecraft source is set on the Orbit & Maneuver tab's Propagate card
(`sc-source-control`): a "Paste TLE" / "Scene object" toggle. Pasting a TLE parses and
validates it on apply (surfacing the located parse error on failure); the scene-object
mode picks a loaded spacecraft by SPICE name. The applied source backs the
propagation runs and mirrors its name into the scenario's primary spacecraft, so the
other tabs share the same role-primary selection. This replaces the former hardcoded
sample TLE.

## The AnalysisLauncher search

A "What do you want to analyze?" search box (`analysis-launcher`) sits at the top of
the tab body. It filters a static registry of cards by intent keyword (across all
tabs) and, on a hit, switches to the owning tab and expands that exact card. For
example "lambert" or "transfer" finds the Lambert transfer card, "pc" or "collision"
finds the closest-approach card, and "downlink" or "ebn0" finds the downlink budget
card. The registry covers the main cards but not every one (the per-event Pc,
watchlist, station-passes, link-worksheet, and slew-feasibility cards are reached by
opening their tab, not by the launcher). An empty query shows nothing.

## Mission-profile presets

A row of mission-profile chips (`mission-presets`) is the per-persona accelerator. It
is not a separate mode and hides nothing; every tab and card stays reachable normally.
Selecting a preset switches to that persona's home tab and pre-expands its primary
cards through the same expand path the launcher uses. The five presets:

- SSA: the Conjunction tab, expanding Catalog ingestion & screening and Closest
  approach (pair). (The full triage path, Per-event Pc & B-plane, is the card just
  below; it is open by default when you enter the Conjunction tab directly.)
- Comms: the Access & Comms tab, expanding the downlink budget.
- Coverage: the Coverage & Constellation tab, expanding the Walker designer and the
  coverage sweep.
- Mission design: the Orbit & Maneuver tab, expanding propagation and the MCS.
- Observation: the Access & Comms tab, expanding the in-FOV observation windows.

## The TaskCard accordion

Within a tab, every tool is a collapsible TaskCard (`taskcard-<id>`): a header button
(`aria-expanded`, keyboard and screen-reader operable) with the intent title, the
one-line purpose, and a status chip (Running / Done / Error mirroring the run status),
and a body that renders only when expanded. The accordion enforces an at-most-two-
expanded cap: expanding a third card collapses the least-recently-expanded one. The
launcher and the presets open cards through the same capped path.

## Whole-variant Compare and the unified export

Every result block can be KEPT into the compare tray (a "Keep" control on each card,
disabled when the tray is full). The compare tray (`compare-tray`, on Report &
Compare) tabulates the kept snapshots side by side, grouped by domain, with columns
the union of that domain's metric keys, so you can weigh trade cases across access,
link, conjunction, coverage, orbit, and lighting at once. Remove a single snapshot,
clear the tray, or export the whole comparison to CSV.

Exports are unified along the same paths: time series and intervals export to CSV with
a run-metadata header, the trajectory exports to a CCSDS OEM, the link worksheet
exports an itemized worst-case and nominal CSV, the FOM summary exports a coverage
CSV, and a selected conjunction event exports a CCSDS-CDM-style record. CSV is
RFC 4180 with formula-injection neutralization.
