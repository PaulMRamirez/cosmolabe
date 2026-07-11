# Bessel UX Improvement Goal

> Status (2026-06-22): HISTORICAL, partially superseded. The analysis-tools
> usability addressed here was carried out by the separate analysis-UX effort
> (docs/analysis-ux-goal.md), which delivered the task-framed six-tab Analyze
> workbench (docs/analysis-workbench.md, docs/analysis-personas.md), replacing the
> flat top-bar analysis popovers this goal diagnosed. The personas and the broader
> shell/onboarding findings below remain useful context; treat the analysis-tool
> portions as delivered. The goal body is left unchanged as a record.

Goal: improve the usability of the Bessel UI and analysis tools for the real set of
end users (flight dynamics analyst, mission operations engineer, mission planner,
payload/science observation planner, educator/outreach/first-run, power user/scripter),
without losing analyst depth or breaking the binding constraints (selene design system,
layering rule, per-chunk size budgets, the axe accessibility gate, fail-loud SPICE
correctness, and desktop/web/mobile from one codebase).

This goal was produced by a multi-persona UX review: two structural inventory passes,
six persona evaluations plus a heuristics/onboarding/accessibility critic (each grounded
in the rendered UI, not just the code), and an adversarial synthesis. The full method and
raw findings live in the session workflow output.

## Diagnosis

Bessel has genuinely strong, STK-class machinery (SPICE-correct geometry, a Yamcs-style
telemetry severity model, real coverage/access/conjunction/OD engines) but exposes it
through 11 flat, auto-dismissing top-bar popovers with heavy concept overlap, no first-run
path, and a left "Objects" rail that buries the object list under camera jargon. All six
personas and the critic independently converged on one root fix: collapse the six
"analysis" menus (Propagate, Mission Design, OD, Report, Analysis, Telemetry) into one
docked, pinnable, tabbed workbench driven by a shared analysis context.

## Product decisions (locked)

1. Surface model: a single adaptive surface for everyone, with smart defaults and
   progressive disclosure (no Explore/Analyze mode switch). Simple by default, analyst
   depth revealed on demand.
2. Workbench form: a pinnable right dock. It opens on demand, stays mounted (results
   survive canvas clicks, timeline scrubbing, and tab switches), is resizable, and reclaims
   canvas only while open.
3. Tool gating and empty state: tools are always visible. Before a real spacecraft is
   loaded they run on bundled sample data with an explicit "sample data" label; once a
   spacecraft loads they default to it. Gating is consistent (no menus that vanish).
4. Shared-context default: J2000 frame and UTC time system, both tagged on screen and in
   exports, both toggleable (TDB and other validated frames available).

Deferred decisions, with the defaults this goal adopts until revisited:
- Canonical first-run sample: "Cassini at Saturn" (the bundled recognizable scene).
- Visibility model: keep the per-object eye in the list and the Layers popover for global
  layers, but co-locate the instrument FOV/footprint toggles with "Show instruments"
  (B11). A full eye-plus-Layers unification is left to a later, deliberate pass.
- Compare tray (B21): hold up to four kept snapshots, same-tool overlays first; cross-tool
  comparison is a later extension.

## Themes (where the pain concentrates)

1. Menu / IA overload and analysis-tool taxonomy (all personas).
2. First-run / onboarding and progressive disclosure (educator, planner, scripter, critic).
3. Situational awareness and live status for ops (ops engineer, analyst, payload).
4. Trust: units, frames, time systems, demo-vs-real data (analyst, planner, ops).
5. Left-rail density and camera-control placement (educator, ops, critic).
6. Visibility model, selection clarity, discoverability of measure (payload, educator, critic, ops).
7. Mobile / touch and small-viewport layout (critic, educator).
8. Result fidelity, busy-state, accessibility and visual hierarchy (analyst, planner, critic).

## Phased plan

### Phase 1: Quick wins (trust + front door, no structural risk) [done]

Land the high-trust and discoverability fixes that need no architectural change.
Backlog: B3, B4, B14, B15, B17, B25, B26, B12.

### Phase 2: Structural IA (the load-bearing restructure) [done]

Consolidate the six analysis menus into one pinnable, tabbed right-dock workbench driven
by a shared analysis context; split the left rail so the object list leads and camera
controls collapse; promote ops status into persistent canvas chrome; add the first-run
welcome path.
Backlog: B1, B2, B5, B6, B7, B8, B9, B10, B11.

### Phase 3: Per-persona depth (built on the new foundation) [done]

State/element readouts, target-bound illumination and FOV visibility, a compare tray, a
real script surface, result tables, mobile/touch collapse, and busy-state feedback.
Backlog: B13, B16, B18, B19, B20, B21, B22, B23, B24.

All three phases are implemented and gate-green (pnpm verify + the full Playwright
suite). Phase 3 shipped as five sub-increments: SI-1 (B18/B24/B21), SI-2 (B13/B20),
SI-3 (B16/B19), SI-4 (B22), SI-5 (B23).

## Backlog

Priority P0 (root + highest trust), P1 (high value), P2 (depth). Impact 1 to 5, effort S/M/L.

| ID | P | Action | Area | Title | Impact | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | P0 | restructure | top bar -> Analyze dock | Consolidate the six analysis menus into one pinnable, tabbed workbench | 5 | L |
| B2 | P0 | add | Analyze dock | Shared analysis-context bar (epoch, span, step, target, observer, frame, time system) | 4 | M |
| B3 | P0 | improve | timeline + epoch fields | Tag every epoch with its time system; offer UTC/TDB | 4 | S |
| B4 | P0 | improve | Mission menu loader | Wire the one-click sample chips and a Load-from-URL field | 4 | S |
| B5 | P1 | add | empty canvas | Dismissible first-run welcome card (load sample / take tour / explore) | 4 | M |
| B6 | P1 | move | Telemetry -> canvas chrome | Persistent telemetry/status strip when a spacecraft is loaded | 5 | M |
| B7 | P1 | restructure | inspector readouts | Bind a live geometry readout to the tracked object, not to selection | 3 | M |
| B8 | P1 | add | timeline | Next-event countdown, click-to-jump markers, go-to-epoch entry, rate gloss | 4 | M |
| B9 | P1 | restructure | left rail | Split into Objects (search+list first) and a collapsible Camera panel | 4 | M |
| B10 | P1 | improve | analysis tool stack | Group tools into labeled sections; fix amber over-use (contrast-safe) | 3 | M |
| B11 | P1 | restructure | instruments + Layers | Co-locate FOV/footprint toggles with "Show instruments" | 3 | M |
| B12 | P1 | improve | Propagate/MCS/OD | Label sample/synthetic runs; make gating consistent | 3 | S |
| B13 | P1 | improve | ReadoutPanel illumination | Drive Phase/Incidence/Emission from each body's catalog frame, not a 6-planet allowlist | 4 | M |
| B14 | P1 | improve | object browser | Single click on a name flies-to/centers, with clear feedback | 3 | S |
| B15 | P1 | improve | analysis CSV + titles | Stamp every result and CSV with run parameters and epoch | 3 | S |
| B16 | P2 | improve | Script console | Cmd+Enter, run-log, verb reference, persist named scripts | 3 | M |
| B17 | P2 | add | Share + Views | Share/bookmark confirmation, per-view Copy link, Export/Import JSON | 3 | S |
| B18 | P2 | improve | result blocks | Chart/table toggle with copy-to-clipboard and precision control | 3 | M |
| B19 | P2 | add | measure + selection | Explicit Measure mode and a Clear-selection affordance | 2 | M |
| B20 | P2 | add | inspector | State section: r/v vectors and osculating elements at epoch | 3 | M |
| B21 | P2 | add | result compare | Compare tray to keep/overlay two or more trade-case results | 4 | L |
| B22 | P2 | add | instruments + Access | Instrument selector and an instrument-target-visibility window tool | 4 | L |
| B23 | P2 | restructure | layout | Responsive collapse for mobile/touch: overflow menu, drawer rail, 44px targets | 4 | L |
| B24 | P2 | add | compute buttons | Inline busy/progress and located success/failure state | 2 | M |
| B25 | P2 | improve | HUD pill | Expand the pill into a one-line ops status strip | 3 | S |
| B26 | P2 | remove | Mission menu | Remove the duplicate telemetry-residual line from OpsPanel | 2 | S |

## Acceptance criteria

- The top bar shows at most about five or six peer entries with a mission loaded (Mission,
  Views, Capture, Analyze, plus the theme toggle and Plugins), down from 11; the six
  analysis menus are reachable as tabs inside one "Analyze" dock.
- An open analysis result stays visible while the user clicks the canvas, scrubs the
  timeline, and switches tools (the workbench does not auto-dismiss).
- Setting epoch/span/step/target/frame once in the context bar drives all analysis tabs by
  default; the same window is honored across propagation, access, OD, and report without
  re-typing, with a per-tool override preserved.
- Every on-screen epoch and every CSV header carries an explicit time-system tag (UTC or
  TDB), and a UTC/TDB toggle exists.
- From a cold open, a first-time user can load a recognizable mission in one click without
  opening any menu, and a Load-from-URL field exists.
- With a spacecraft loaded, the live telemetry residual, severity, and fault banner are
  visible in always-mounted canvas chrome, and a fault role=alert fires while no menu is
  open.
- Tracking a spacecraft shows live Range/Altitude/Phase without requiring a selection.
- The left "Objects" panel shows the search box and object list first; camera/view/frame
  controls live in a separate collapsible "Camera" panel, and the Frame-mode/Lock-frame
  dependency is explicit (no silently dead select).
- Phase/Incidence/Emission resolve for catalog moons and minor bodies, failing loudly to
  "n/a" only when genuinely unresolvable.
- Every analysis CSV and result title carries the run parameters (mission, epoch, span,
  step, target, frame).
- The axe accessibility gate stays green (no serious or critical, including color contrast)
  and keyboard support is preserved across the restructured surfaces.
- The first-paint shell JS budget (310 KB) is unchanged: new heavy panels stay behind
  dynamic-import/PanelSuspense boundaries.
- At a phone breakpoint the menus collapse into an overflow or tab affordance, the rail
  becomes a drawer, corner clusters do not overlap, and primary touch targets meet about
  44px.

## Risks

- Consolidating six menus into one dock (B1) touches viewer.tsx layout, the lazy boundaries,
  and per-tool state; done carelessly it could pull lazy panels into the first-paint shell
  and blow the 310 KB budget. Keep every tab body behind its dynamic import; verify
  pnpm size after.
- The persistent telemetry strip (B6) and the dock add always-mounted chrome; on the warm
  dark theme and at small viewports this risks the axe color-contrast gate and corner
  overlap. Validate axe and the phone breakpoint in the same change.
- The shared context (B2) changes the contract every tool reads; keep a per-tool override
  and a clear "using shared context" indicator so expert per-tool frame/epoch workflows do
  not regress.
- Single-click fly-to (B14) and a Measure mode (B19) change long-standing select semantics;
  update the e2e tests and the cosmoscript selectObject verb mapping together.
- Catalog-frame illumination (B13) must keep the fail-loud "n/a" path for bodies with
  missing or wrong PCK frames rather than throwing.
- Mobile collapse (B23) must gate strictly on viewport so it does not regress desktop
  density.

## Method note

Produced by the `bessel-ux-review` workflow (10 agents: 2 inventory readers, 6 personas,
1 heuristics/onboarding/accessibility critic, 1 synthesizer), grounded in both the source
and rendered screenshots of the default view, the top bar, a loaded mission, the Analysis
workbench, the Mission Design panel, and the left rail.
