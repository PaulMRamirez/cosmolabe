# Goal: simplify the Bessel UI and improve the UX

Status: IMPLEMENTED (2026-06-22). 37 of the 45 findings are implemented on the
feat/ui-simplification branch across 10 commits, each green through `pnpm verify`
plus targeted `pnpm e2e`. Done: every non-dismissable-window finding (F01/F02/F03/F12
plus the shared CloseButton dismiss-model unification F39), every clean icon
conversion (F05/F06/F09/F10/F11/F38), the copy/reset/export/empty-state parity
(F14/F15/F16/F17/F19/F22/F23/F25/F27/F31/F36/F41), the consistency fixes
(F24/F37/F40/F42/F43), ground-track legend/enlarge (F28/F29), station edit (F30),
script history (F18), keyboard re-run (F13), the HUD telemetry link (F32), and the
pinnable Script console (F46 MVP).

Deferred with rationale (not silently dropped):
- F07/F08/F35 (iconify/de-dup the FOV/Footprint/Share viewcontrols strip): needs a
  real cone/footprint icon set; ambiguous unicode glyphs would hurt the
  recognizability the review prioritizes, and the inline toggles are a contextual
  affordance the instruments e2e asserts. A deliberate strip redesign, not a quick win.
- F44 (extract one shared override control): the premise does not hold on inspection.
  The override is already default-collapsed behind "Use shared context"; CoveragePanel
  genuinely consumes params.span; ReportPanel's override has different semantics
  (observer + minutes + grid). A single generic control would add generality, not
  simplicity.
- F34 (cooperative cancel for span tools): the span tools are single batched WORKER
  calls, not interruptible main-thread loops, so a real cancel needs a cancellable
  worker-job protocol (infra change). The long sweeps that need cancel (screening,
  coverage, porkchop) already have it. A discard-result cancel would be partly fake.
- F26 (coverage fork): subsumed by F24 (coverage snapshots now capture the Walker
  design, so comparing variants works via run/Keep/edit/run).
- F45 (camera disclosure) and the jump-to-card half of F33: low value.

Source: the `ui-ux-simplification-review` workflow
(6 analyst personas, flight-dynamics analyst, mission-ops engineer, mission planner,
observation planner, educator/first-run, power-user/scripter, plus a senior UI/UX
expert; findings deduped, then adversarially verified against the source, then
synthesized). 63 raw findings, 46 unique, 45 confirmed (1 refuted).

North star (completion criterion): every panel and overlay has a predictable
dismiss model, dense text-button rows that read as noise become unambiguous icon
buttons (tooltip + aria-label preserved), and the copy/clear/reset/export/empty-state
affordances and keyboard paths reach parity across sibling panels, with `pnpm verify`
and `pnpm e2e` green and the first-paint shell budget unchanged.

The plan below is the synthesized output, retained verbatim as the record.

---

# Bessel UI Simplification Plan

## Executive summary

Forty-five findings were verified against the source (one refuted in verification, not included). The dominant themes are: (1) panels and overlays that cannot be dismissed, only collapsed or not at all; (2) text buttons that should be compact, unambiguous icon buttons; (3) missing copy/clear/reset/export affordances and keyboard paths; plus consistency drift (three dismiss models, three CSV button primitives, mixed delete idioms) and redundant span/step override surface. The highest-leverage work is small and concentrated: add a single close "X" to the inspector card and the live-geometry/fault overlays, iconify the already-glyph-adjacent transport and capture controls, and add Copy/Reset/empty-state affordances that mirror patterns the codebase already ships (StateVectorPanel's Copy, CompareTray's Clear, WelcomeCard's ✕). Most fixes reuse an existing idiom rather than inventing a primitive, so risk is low and the simplification dividend (fewer clicks, predictable dismissal, one home per setting) is high.

Counts: 12 button-to-icon, 4 non-dismissable, 19 missing-affordance, 7 consistency, 3 simplification. By severity: 6 high, 30 medium, 9 low.

---

## 1. Button-to-icon

| Component | Current | Recommendation | Severity | Effort |
|---|---|---|---|---|
| F09 McsSegmentEditor (mcs-segment-*-up/-down/-remove) | Three text Buttons Up/Down/Remove per segment row, each already with a title | Glyph children ▲/▼/✕ on the same ghost Buttons; keep title as accessible name (selene Button has no aria-label prop, so add one or rely on title); reuse CompareTray's ✕ span | medium | small |
| F05 CaptureControls (capture-still, capture-record) | Full text "Capture image" and "Record video"/"Stop recording", capture-still has no aria-label | Iconify record/stop (red dot → square) with aria-pressed + aria-label + Tooltip; camera glyph for still is optional; add aria-label to both | medium | small |
| F06 TimelineControls Play/Pause | Text Play/Pause is the only non-glyph control in an otherwise iconified ⏮◀▶⏭ transport row | Glyph ▶/⏸ matching renderStep pattern; explicit aria-label; keep aria-pressed and data-testid="timeline-play" | medium | small |
| F12 CompareTray snapshot chip | Whole chip "{label} ✕" is the remove button; clicking the variant name destroys it | Make label a non-interactive span; only a separate ✕ icon-button removes; move aria-label/data-testid to the ✕ | medium | small |
| F07 viewer.tsx Share view | Text "Share view" button in the bessel-viewcontrols strip among text siblings | Share/link glyph + Tooltip + aria-label "Share view"; ideally iconify the whole strip in the same pass to avoid one lone icon | low | small |
| F08 viewer.tsx toggle-fov / toggle-footprint | Full text "Sensor FOV"/"Footprint" buttons in the always-on bottom strip | Icon buttons (cone / footprint ellipse) + Tooltip + aria-label, keep aria-pressed; gate on F18/F35 de-dup first; SettingsPanel labeled fallback already exists | low | small |
| F10 analysis-result ResultView (view-chart/view-table) | Two text Buttons Chart/Table repeat on every Series/Interval result in the narrow right dock | Compact icon segmented control (line-chart / grid glyph), keep aria-pressed + Tooltip; leave Copy and Digits | low | small |
| F11 CameraFrameControls (Dolly/Crane) | Four text buttons with jargon labels and key hints (R/F, T/G) | Directional icons (zoom-in/out, up/down chevrons), keep title AND add aria-label so jargon + keys survive in tooltip/SR | low | small |

---

## 2. Non-dismissable windows

| Component | Current | Recommendation | Severity | Effort |
|---|---|---|---|---|
| F01 viewer.tsx inspector-card aside (ObjectInspector + ReadoutPanel + MeasurePanel + StateVectorPanel) | Tall four-section card with no header close; only dismiss is MeasurePanel's "Clear selection", gated on hasSelection. (Verification: turning Measure mode off also hides it, but that path is non-discoverable.) | Add one header-level ✕ that clears selection AND exits measure mode in one action, matching WelcomeCard/AnalyzeWorkbench; clear-on-close is the consistent choice | high | small |
| F03 FaultBanner (TelemetryOverlay) | Persistent red role="alert" banner over the canvas, no acknowledge; clears only when fault state self-clears | Add Acknowledge/✕ that suppresses by fault string (re-raises on a changed fault), keep role="alert", aria-label "Acknowledge telemetry fault"; gate behind a dismissable prop so only the canvas instance shows it | high | small |
| F02 LiveGeometryReadout strip | Range/Altitude/Phase strip shows whenever tracking or focused-on-spacecraft, no hide/close | Dismiss caret/✕ decoupled from camera state, backed by a "Show live geometry readout" boolean in SettingsPanel; thread the handler from viewer.tsx (component is presentational) | medium | small |
| F04 CompareTray per-domain group | Per-domain compare group cannot collapse/hide; only declutter is destructive remove/clear | Make each compare-domain group collapsible (header toggle, aria-expanded, defaults open) reusing PanelContainer/TaskCardAccordion idiom; non-destructive fold | medium | medium |

---

## 3. Missing affordances

| Component | Current | Recommendation | Severity | Effort |
|---|---|---|---|---|
| F14 OdPanel od-result | Three plain <p> with no Copy, CSV, or Keep, unlike every sibling result | Add Copy, Export CSV (ResultCsv), and Keep (domain orbit, NOT od which is not a SnapshotDomain) | high | medium |
| F24 engine.keepSnapshot + coverage snapshot metrics | Coverage snapshots labeled "coverage 1/2", capturing only outputs; design inputs (Walker T/P/F, alt, inc, FOM) lost; JSDoc "Walker delta 24/3/1" unmet | Build label "Walker {pattern} {T/P/F}" from constellation state; prepend design rows to the coverage metrics case; per-kind label builder | high | medium |
| F13 keymap + TaskCard Action re-run | KEYMAP has no modifier support and swallows keys in inputs; no keyboard re-run; no global chords for Analyze/Script/Views/tracking | Cmd/Ctrl+Enter re-runs the focused TaskCard's Action (bypass isEditableTarget for that chord, thread onRun ref); add global chords via new KeyboardAction variants; surface in KeyboardHelp | high | medium |
| F32 viewer.tsx Operations HUD residual | Residual is read-only; no path to full TelemetryOverlay (buried under Analyze > Report & Compare); no copy | Make residual cell a button: toggleAnalyze + setAnalyzeTab('report-compare'); add a copy-readout icon button (reuse clipboard fallback) | medium | medium |
| F15 ReportPanel report-result | ReportTable + Export CSV only; no Copy, no Digits selector (siblings have both); reportToText unwired | Add a toolbar: Copy via reportToText with idle/ok/fail feedback + a Digits select over PRECISIONS; keep Export CSV | medium | small |
| F16 ReadoutPanel geometry list | StateVectorPanel has Copy; sibling ReadoutPanel above it does not | Add a ghost Copy Button mirroring StateVectorPanel (reuse km()/deg() formatters); LiveGeometryReadout copy optional | medium | small |
| F17 ScriptConsole output + verb reference | Run log has only "Clear log", no Copy/Export; Verb reference <details> starts collapsed every reopen | Add "Copy log" beside "Clear log" (disable when empty); default Verb reference <details> open | medium | small |
| F18 ScriptConsole history | No recall of prior submitted sources; only named saves; "Run again" already covered by Run script | ArrowUp/Down ring-buffer history gated to caret-at-top/empty; drop the redundant Run again idea; document keys in KeyboardHelp | medium | medium |
| F19 SettingsPanel layers | Ten layer checkboxes, no bulk control; no way back to defaults | "Reset to defaults" button restoring the canonical set (app-state defaults); onReset prop + store action; disable when already default | medium | small |
| F22 AnalysisLauncher search | Empty/no-match shows nothing; no keyboard path into results; no empty-state hint | ArrowDown/Enter active-descendant nav; empty-state listing searchable domains or "Browse all"; combobox ARIA | medium | medium |
| F23 CompareTray cap | Silent 4-snapshot cap; Keep buttons disable with no explanation | "Kept N / 4" badge + "Tray full" note when full; optional "0 / 4" in empty state | medium | small |
| F25 CoveragePanel reset params | Two forms never reset from DEFAULT_* after edits; "Clear coverage grid" only clears the result | "Reset" ghost button per form (setParams(DEFAULT_*)), disabled when at defaults; ideally a shared affordance in analysis-shared since Orbit/Conjunction/AccessComms share the pattern | medium | small |
| F26 CoveragePanel fork variant | No fork: producing 24/3/1 vs 24/4/1 means hand-editing Planes and recomputing | Add Duplicate design / Fork on the constellation card (re-assert params, leave form populated); the into-tray half needs a new constellation SnapshotKind + Keep button (larger) | medium | medium |
| F28 GroundTrackMap legend/labels | No legend; station names live only in hover <title> (unusable on touch) | Render station names as on-map <text> (clamped); add a compact key; keep <title> fallback; labels toggleable/density-gated | medium | medium |
| F29 GroundTrackMap enlarge | Fixed 280x140, no enlarge; width/height props already exist | Enlarge/Collapse toggle next to the projection select passing width/height (thumbnail vs 560x280); effort closer to low | medium | medium |
| F30 StationRegistryControl edit/visibility | No edit of an existing station (remove-and-re-add); all stations always draped on the map | Add Edit (load draft + re-save; engine needs updateStation or overwrite-by-id); a single "Show stations on map" toggle; per-station visibility optional | medium | medium |
| F31 observation-schedule-card | No CSV export (every sibling exports), no Clear targets, unscheduled rows inert | (1) CSV export via tableToCsv + downloadBlob; (2) Clear targets ghost button; (3) per-row remove from unscheduled (scoped separately for string-edit edge cases) | medium | medium |
| F21 KeyboardHelp '?' trigger | Bare '?' button has aria-label but no hover Tooltip (theme toggle has one) | Wrap '?' in <Tooltip label="Keyboard shortcuts and help (press ?)">; Layers tooltip optional/low-value (self-labeling) | medium | small |
| F33 access-comms-cards not-ready hints | Hints are descriptive only; passes card often collapsed by the 2-expanded cap; no inline path | Make hints actionable: ExpandRequest to station-passes (bumped token); show bound pass/pair as a clearable chip; inline "Add a station" focusing the add toggle | low | medium |
| F34 analysis-shared Action cancel | Running Action is disabled with no stop; conjunction has cancel, access/station-passes do not | Optional onCancel via a cooperative cancel token in the main-thread loops; scope to span-based tools | medium | medium |
| F27 TaskCardAccordion expand/run-all | 2-expanded cap silently collapses a third; no expand/collapse-all; Lighting's five cards have no run-all | Accordion header Expand/Collapse all shown only when cards > cap; inline cue on silent collapse; Lighting "Compute all" over the five span ops; drop CoveragePanel citation | low | medium |
| F43 PresetBar pressed state | Comms and Observation share tab access-comms, so opening either marks BOTH chips pressed | Track last-applied MissionPreset in state; drive aria-pressed from preset === entry.preset; clear on non-preset navigation | low | small |

---

## 4. Consistency

| Component | Current | Recommendation | Severity | Effort |
|---|---|---|---|---|
| F35 FOV/Footprint duplicated | Same setting as a pressed-button (viewcontrols) and a checkbox (SettingsPanel) | Make SettingsPanel the single home; remove the inline aria-pressed buttons (always reachable, grouped with other layers) | medium | small |
| F36 PcCard result actions | Export CDM/Plan avoidance are ghost text Buttons; export elsewhere is secondary; Pc numbers have no Copy | Add Copy to the Pc block (mirror StateVectorPanel); change Export CDM ghost → secondary; leave Plan avoidance | medium | small |
| F38 KeyboardHelp close | Closes via bottom text "Close"; every other surface uses top-right ✕ | Top-right ✕ matching WelcomeCard/AnalyzeWorkbench (shared class), keep Escape; standardize the verb | medium | small |
| F39 Dismiss models | Three models: header ✕, caret-collapse-only, nothing; user cannot predict | Standardize on header ✕ = close (uniform "Close <name>" label/class) and caret = collapse only; apply close ✕ to the inspector card (umbrella over F01/F02/F38) | medium | medium |
| F40 pass selection idioms | Single pass = per-row Bind toggle; slew pair = a separate <select> | Move pair binding onto rows as a "Pair with next"/"Paired" toggle (disabled on last row); keep consecutive-only; remove the <select> | medium | medium |
| F41 saved-script delete | Script delete is a select + gated Delete (two-step); views/snapshots use per-row ✕ | Per-row saved-scripts list matching BookmarksPanel (Load + per-row ✕); add empty state | medium | medium |
| F37 FomSummaryTable CSV button | Raw <button className="bessel-csv-button"> while others use selene Button (3 raw instances total) | Swap to selene Button variant="secondary" keeping the class; also fix PropagatePanel and link-worksheet CSV; verify compact sizing survives | low | small |
| F42 export/clear/copy verbs + primitives | Export CSV vs Export JSON, Clear vs Clear log; selene Button vs bare <button> mixed | Migrate ScriptConsole/BookmarksPanel to selene Button with variants; normalize "Clear"; keep the export FORMAT visible (CSV/JSON are genuinely different data) | low | medium |

---

## 5. Simplification

| Component | Current | Recommendation | Severity | Effort |
|---|---|---|---|---|
| F46 Script popover vs Analyze dock | Script lives in an auto-dismissing top-bar Popover; canvas clicks close it (source/log persist, but reopen friction + lost in-place context) | Promote Script to a pinnable, non-auto-dismissing dock (reuse AnalyzeWorkbench pattern); share the right slot with Analyze (tabbed/mutually exclusive); MVP: a pin toggle suppressing outside-pointerdown | medium | medium |
| F44 span/step override duplication | Use-shared + span/step/target re-implemented in useAnalysisParams AND ReportPanel, atop AnalysisContextBar; CoveragePanel mounts a redundant pair | Extract one shared Override-context control reused by domain panels and ReportPanel, default collapsed; drop the redundant paramsBar from CoveragePanel; preserve data-testids | low | medium |
| F45 Camera panel density | 11+ controls (3 presets + 4 modes + frame select + 4 motion buttons) in one panel | Move Dolly/Crane into a "More motion" disclosure; do NOT delete (only pointer/touch path on Capacitor where R/F/T/G keys do not exist) | low | medium |

---

## Quick wins (high value, small effort)

1. F01 inspector-card: add one header ✕ that clears selection and exits measure mode (viewer.tsx ~581).
2. F03 FaultBanner: add an Acknowledge/✕ keyed on the fault string, gated by a dismissable prop.
3. F38 KeyboardHelp: replace the bottom "Close" text with a top-right ✕ matching the others.
4. F06 TimelineControls: render Play/Pause as ▶/⏸ glyph matching the flanking transport buttons.
5. F09 McsSegmentEditor: swap Up/Down/Remove text for ▲/▼/✕ on the same Buttons.
6. F16 ReadoutPanel: add a ghost Copy button mirroring StateVectorPanel.
7. F19 SettingsPanel: add a "Reset to defaults" button for the ten layer toggles.
8. F23 CompareTray: add a "Kept N / 4" badge explaining the silent cap.
9. F35 FOV/Footprint: drop the duplicate inline buttons, keep the SettingsPanel checkboxes.
10. F21 KeyboardHelp '?': wrap the trigger in the existing Tooltip.

## Bigger changes

1. F39 unify dismiss models (header ✕ vs caret collapse) across all surfaces; umbrella over F01/F02/F38.
2. F13 keyboard re-run (Cmd/Ctrl+Enter) plus global chords; extend the keymap with modifier support and per-card refs.
3. F24 capture Walker design inputs into coverage snapshot labels/metrics; per-kind label builder.
4. F46 promote Script to a pinnable dock sharing the right slot with Analyze.
5. F44 extract one shared Override-context control; drop CoveragePanel's redundant span/step.
6. F22 AnalysisLauncher keyboard nav + empty-state/Browse-all + combobox ARIA.
7. F40 / F41 unify pass-selection and saved-script idioms onto per-row controls.
8. F28 / F29 / F30 GroundTrackMap legend + on-map labels + enlarge + station edit/visibility.
9. F31 observation-schedule CSV export, Clear, and conflict-row actions.
10. F34 cooperative cancel for span-based runs.

## Rollout

Phase 1 (dismiss + quick consistency, ship first): the ten quick wins above, dominated by close/dismiss affordances (F01, F02, F03) and the cheap consistency unifications (F35, F37, F38). Low risk, each reuses an existing idiom, immediately improves predictability.

Phase 2 (affordance parity + iconification): the remaining icon conversions (F05, F07, F08, F10, F11, F12) and the copy/reset/export/empty-state affordances (F14, F15, F17, F25, F31, F43), plus F36. These add capability without removing any, and bring panels to parity with their siblings.

Phase 3 (structural simplification + keyboard): the bigger changes that touch shared plumbing or layout: the dismiss-model standardization F39, keyboard system F13, snapshot-identity F24, Script-as-dock F46, override de-duplication F44, AnalysisLauncher F22, idiom unification F40/F41, GroundTrackMap suite F28/F29/F30, cancel F34, accordion expand/run-all F27, and Camera disclosure F45.