# Analysis Workbench: Per-Perspective Use Cases

Five concrete walkthroughs through the implemented analysis workbench, one per
analyst perspective. Each gives the entry point (tab or mission-profile preset), the
steps through the real cards and controls, and the outputs and decisions. For the
workbench's structure and shared controls see docs/analysis-workbench.md; for the
engine behind each card see docs/analysis-tools.md.

Every walkthrough follows the same universal flow: Scenario/Context -> Choose ->
Configure -> Run -> Interpret & Visualize -> Compare/Export/Decide.

---

## 1. Mission / Trajectory Designer

Entry: the "Mission design" preset, or the Orbit & Maneuver tab (`tab-orbit-maneuver`).
The preset opens the tab and pre-expands the Propagate and Mission control sequence
cards.

Steps:

1. Set the spacecraft source. On the Propagate card the spacecraft-source control
   (`sc-source-control`) offers a "Paste TLE" / "Scene object" toggle. Paste your own
   two-line element set; it is parsed and validated on apply, and a bad TLE surfaces a
   located parse error (`sc-source-error`) rather than failing silently. This replaces
   the former hardcoded sample TLE.
2. Propagate and compare. Run "Propagate (SGP4)" and "Propagate numerically (HPOP)"
   with a selectable HPOP force model (point-mass / J2 / NxN gravity / drag / SRP).
   The two altitude series overlay so you can read the SGP4-vs-HPOP divergence, plus
   the ground track and orbit period.
3. Build the maneuver plan. On the Mission control sequence card the editable MCS
   segment editor (`mcs-segment-editor`) lets you add InitialState / Propagate /
   Maneuver / Target segments, edit each segment's key parameters, reorder (up/down),
   and remove. Assemble a four-plus-segment sequence.
4. Run the corrector. Running the MCS executes the differential corrector; the
   residuals converge to the Target goal (e.g. a desired radius or SMA), and the
   solved trajectory draws in the 3D scene (camera-relative).
5. Design a transfer. On the Lambert transfer + porkchop card, set the departure and
   arrival bodies, the departure-window day range, and the time-of-flight day range,
   then "Sweep porkchop (worker)" with progress and cancel. The departure-delta-v
   contour renders (`porkchop-result`) with the minimum marked, and "Send to MCS"
   appends that optimum's burn to the editable MCS so you flow porkchop -> MCS without
   re-typing.

Outputs / decisions: a validated propagation source, an SGP4-vs-HPOP altitude
comparison, a converged multi-segment MCS with a 3D solved arc, and a porkchop-optimal
transfer fed back into the sequence. Keep any result for the compare tray.

---

## 2. Communications / Ground-Station Engineer

Entry: the "Comms" preset, or the Access & Comms tab (`tab-access-comms`). The preset
opens the tab and pre-expands the Downlink budget card.

Steps:

1. Register the ground station. In the shared context bar the station registry
   (`station-registry`) adds a station (name, lon, lat, alt, and a min-elevation mask
   in degrees) and selects it as the active station. The access/comms cards read this
   active station by role.
2. Find the passes. On the Station passes card, "Compute station passes" finds the
   rise/set passes over the active station against its az/el mask, with the
   max-elevation and range per pass and a coverage/max-gap figure of merit
   (`station-passes-fom`). The card is gated until a station is selected.
3. Bind a pass. Click a pass row's "Bind" button (`select-pass-<id>`) to make it the
   active selection the worksheet reads.
4. Assemble the link-budget worksheet. On the Link-budget worksheet card, configure
   the link, then "Assemble link worksheet". It produces the itemized line-by-line
   budget at the worst-case and nominal elevation of the bound pass (two tables), the
   modcod margin against the required Eb/N0, and a margin-vs-time chart
   (`link-margin-chart`) with the link-closes threshold (margin = 0) drawn. With no
   pass bound it uses a representative geometry.
5. Spot-check Eb/N0. The Downlink budget card plots Eb/N0 over the pass for the
   configured radio link as a quick read.

Outputs / decisions: the pass schedule with max elevations, an itemized worst-case and
nominal link budget with the modcod margin, and a margin-vs-time plot. Export the
worksheet CSV (`link-worksheet-csv`, self-describing with the modcod and pass id) and
Keep the worksheet and passes into the compare tray to weigh station or modcod
variants side by side.

---

## 3. SSA / Conjunction Analyst

Entry: the "SSA" preset, or the Conjunction tab (`tab-conjunction`). The preset opens
the tab and pre-expands the Catalog ingestion & screening and Closest approach (pair)
cards. The Per-event Pc & B-plane card (where the triage in steps 3 to 7 happens) sits
just below; opening the Conjunction tab directly instead pre-expands Catalog ingestion &
screening and Per-event Pc & B-plane by default. Either way, expand whichever card a step
names (the accordion keeps at most two open).

Steps:

1. Ingest real data. On the Catalog ingestion & screening card, pick a format (CCSDS
   CDM / CCSDS OEM / TLE set) and paste a document (a per-format "Load sample" button
   supplies a runnable one). "Ingest catalog" parses it for real (parseCdm / parseOem /
   parseTle) into the screening catalog, reporting the object count and how many
   carried covariance (`ingest-summary`).
2. Screen. Set the threshold (km) and sieve pad (km) and "Screen ingested catalog
   (worker)": an all-vs-all screen runs on the dedicated worker with a
   primaries-done/total progress readout and a cancel.
3. Triage. On the Per-event Pc & B-plane card, the screened events show in a
   Pc-colored table sortable by TCA / miss / Pc. Click an event row to select it.
4. Assess the selected event. Selecting computes the full-covariance Pc (combine the
   per-object covariances, propagate to the common TCA, evaluate) plus the Max-Pc
   (Alfano) bound, and renders the B-plane (encounter-plane) plot with the 1- and
   3-sigma covariance ellipses, the miss vector, and the hard-body circle.
5. Supply a covariance when missing. If the catalog (OEM or TLE) carried no covariance
   for the pair, the covariance-input form (`covariance-input`) appears: enter a 3x3
   position covariance for the primary or secondary in the RTN or inertial frame, as
   three per-axis sigmas or, in advanced mode, the six independent entries; it is
   validated (fail-loud on a non-PD matrix), rotated, and the Pc recomputed.
6. Plan an avoidance burn and re-screen. "Plan avoidance burn" seeds an impulsive
   avoidance maneuver in the editable MCS (a cross-tab carrier into Orbit & Maneuver).
   After solving the burn, "Screen after maneuver" applies the solved burn to the
   primary, re-screens it against the catalog, and shows the before-vs-after Pc and
   miss for the pair (`pc-before-after`, marked risk reduced or not).
7. Watch. "Watch" adds the pair to the Watchlist card, where each tracked pair shows
   its current Pc and miss and a rose/fell trend chip that updates on re-screen or
   covariance input.

Outputs / decisions: a triaged screening table, per-event full-covariance Pc and
Max-Pc with a B-plane, a risk reduction from the avoidance burn, and a tracked
watchlist. Export the selected event as a CCSDS-CDM-style record (`export-cdm`) and
Keep the per-event Pc into the compare tray.

---

## 4. Coverage / Constellation Planner

Entry: the "Coverage" preset, or the Coverage & Constellation tab (`tab-coverage`).
The preset opens the tab and pre-expands the Walker constellation and Coverage sweep
cards.

Steps:

1. Design the constellation. On the Walker constellation card, set the Walker T/P/F
   pattern (total satellites, planes, phasing, inclination, altitude). The run is
   gated on a buildable T/P (total must be a positive multiple of the planes,
   `constellation-invalid` otherwise). "Design Walker constellation" renders it as
   orbit rings AND publishes its members as the swept asset set.
2. Configure the sweep. On the Coverage sweep card, the asset note confirms whether
   the sweep runs over the designed Walker asset set or the loaded spacecraft. Set the
   grid resolution and region (lat/lon counts and bounds), the FOM metric to color by,
   and the N-fold k.
3. Run the worker sweep. "Run coverage sweep" runs on the dedicated coverage worker
   with a live cells-done/total readout (`coverage-progress`) and a cancel, so a large
   global sweep never stalls the UI.
4. Read the result. The result shows the area-weighted percent coverage over the
   cells (`coverage-grid-stat`), a metric-aware contour drawn as a camera-relative
   overlay on the globe, an on-panel legend keyed to that metric (`ContourLegend`),
   and a regional FOM summary table.

Outputs / decisions: a designed Walker constellation rendered in 3D, a metric-aware
coverage contour, and a regional FOM summary. Export the FOM summary CSV
(`coverage-fom.csv`) and Keep the coverage result into the compare tray to compare
constellation variants.

---

## 5. Attitude / Sensor & Observation Planner

Entry: the "Observation" preset, or the Access & Comms tab (`tab-access-comms`). The
preset opens the tab and pre-expands the In-FOV observation windows card.

Steps:

1. Build the constraint stack. On the Constraint-stack access card, the constraint
   form composes line of sight, az/el mask (against the active station), sun-exclusion
   keepout, range, range rate, and terrain line of sight. Running it yields the
   surviving access window with a per-constraint breakdown (`access-breakdown`) of what
   each constraint alone admits.
2. Find in-FOV windows. On the In-FOV observation windows card, choose the pointing
   mode (nadir or sun) and "Compute in-FOV". You get the FOV-only window and the
   post-constraint surviving window (the in-FOV window intersected with the constraint
   stack), each with its figure of merit, so you can see how the keepout and az/el mask
   carve down the raw FOV visibility. The FOV and sun-keepout cones render in the 3D
   scene.
3. Schedule across targets. On the Observation multi-target schedule card, enter a
   target list (comma or space separated), the pointing mode, and a minimum dwell, then
   "Build schedule". The engine builds a conflict-free, slew-feasible schedule: an
   ordered, non-overlapping observation timeline where the attitude slew between
   consecutive targets fits the gap (`multi-target-schedule`), plus any unscheduled
   targets and their reasons.
4. Check slew feasibility between passes. On the Station passes card, select two
   consecutive passes via the slew-pair select; the Slew feasibility card then compares
   the eigen-axis slew duration between them against the gap and reports FITS / does NOT
   fit with the slew angle, duration, gap, and slack (`slew-fits`).

Outputs / decisions: FOV-only vs post-constraint surviving observation windows with a
per-constraint breakdown, a conflict-free multi-target observation timeline, and a
slew-feasibility verdict between passes. Keep the access, FOV, and slew results into
the compare tray to weigh pointing-mode and constraint variants.
