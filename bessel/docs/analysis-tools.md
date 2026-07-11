# Analysis Tools Reference

One entry per tool: its inputs, what it computes, the engine behind it, its
validation, and its limits. The tools live in the consolidated analysis workbench
(the right-dock "Analyze" panel), organized into six intent-named domain tabs of
collapsible TaskCards: Orbit & Maneuver, Lighting & Geometry, Access & Comms,
Conjunction, Coverage & Constellation, and Report & Compare. For the structure and
shared controls of that workbench see docs/analysis-workbench.md; for the
per-perspective walkthroughs see docs/analysis-personas.md; for a guided first run
see docs/getting-started.md; for the validation provenance see REFERENCES.md and
docs/STK_PARITY_SPEC.md. The tool entries below keep their original menu groupings
as a per-engine index; the mapping to the workbench tabs is noted where it helps.

## How to read this reference

- The workbench opens once a spacecraft mission is loaded; the Report & Compare and
  Propagate tools are always available. The spacecraft a task analyzes comes from the
  editable spacecraft source on the Orbit & Maneuver Propagate card (a pasted TLE or a
  picked scene object), not a bundled sample TLE.
- The shared context bar sets the span, step, target, observer, frame, and active
  ground station once for every tab; each TaskCard adds its own parameters. Deep
  capabilities (full-covariance Pc, B-plane, beta angle, az/el mask, sun keepout,
  terrain LOS, range rate, area-weighted FOM, modcod margin, covariance input) are
  parameters and toggles on the cards, not hidden engine-only features.
- Every result can be Kept into the compare tray and exported. Time series and
  intervals export to CSV; the trajectory exports to a CCSDS OEM; a selected
  conjunction event exports a CCSDS-CDM-style record; the link worksheet exports an
  itemized worst-case and nominal CSV; the coverage FOM summary exports a CSV.

### Honest limits (read this first)

- The tools are configurable from the UI: the shared context bar drives span, step,
  target, observer, frame, and the active ground station, and each card carries its
  own parameter form (e.g. the porkchop departure and time-of-flight ranges, the
  screening threshold and pad, the link and worksheet parameters, the constraint
  stack, the Walker pattern, and the coverage grid/metric/N-fold). Some per-tool
  defaults below describe a representative starting configuration, not a fixed,
  unchangeable demo.
- SGP4 produces TEME coordinates; Bessel publishes them as J2000, an
  arcminute-scale approximation near the element epoch. An EOP-aware TEME to
  J2000 transform is deferred (docs/STK_PARITY_SPEC.md).
- The numerical propagator ships point-mass, zonal and full NxN tesseral spherical
  harmonics (`packages/propagator/src/force/spherical-harmonics.ts`), a third-body
  term, atmospheric drag (`force/drag.ts`, with Harris-Priester and Jacchia-1971
  density models), and solar radiation pressure (`force/srp.ts`), all selectable in
  the force model (the HPOP card's force-model selector).
- Each engine is validated against an independent reference (below). Treat absolute
  numbers from a representative starting configuration accordingly.

---

## Analysis menu

### Eclipse phases
- Workbench: the Lighting & Geometry tab, the Eclipse phases card.
- Inputs: the loaded spacecraft and its central body, over the shared context span
  and step.
- Computes: the umbra (total shadow), penumbra (partial), annular, and sunlit
  intervals, each a Gantt timeline, plus the per-day shadowed duration.
- Engine: `@bessel/events` (CSPICE `gfoclt` occultation finder + `occult`).
- Validation: `gfoclt` intervals cross-checked against the per-epoch `occult`
  code; tested on the Cassini-at-Saturn shadow.

### Range (time series)
- Inputs: spacecraft to central body, one-day span at a 360 s step.
- Computes: the scalar range (km) over time, plotted as a line chart.
- Engine: the F3 `evalSeries` `range` provider over the SPICE worker.
- Validation: the interpreter reproduces per-epoch `spkpos` to sub-millimeter.

### Access + figure of merit
- Workbench: the Access & Comms tab, the Constraint-stack access card (and the Sun
  exclusion / line-of-sight cases it composes).
- Inputs: spacecraft to a target (or the Sun) over the shared context span and step,
  under a composable constraint stack.
- Computes: the surviving access window (a Gantt), reduced to a figure of
  merit (percent coverage, access count, maximum gap), with a per-constraint
  breakdown of what each constraint alone admits.
- Engine: `@bessel/access` (geometry finders + `SpiceWindow` algebra) and
  `@bessel/coverage` (`figureOfMerit`).
- Note: the constraint stack surfaces line of sight, az/el mask, sun-exclusion
  keepout, range, range rate, and terrain line of sight as toggles on the card; the
  station and report tools below add the ground-station and provider-grid cases.

### Downlink Eb/N0 (link budget)
- Inputs: spacecraft to Earth range over a day; a representative DSN 34 m X-band
  station (EIRP 90 dBW, G/T 53 dB/K, 8.4 GHz, 14 kbps).
- Computes: the downlink Eb/N0 (dB) over time.
- Engine: batched `spkpos` for geometry plus `@bessel/rf` (Friis path loss,
  antenna gain, link-budget roll-up; ITU-R rain/gaseous attenuation and a typed
  comm-entity schema are available in the package).
- Validation: link math against textbook/ITU anchors.

### Conjunction (closest approach + Pc)
- Workbench: the Conjunction tab. The single-pair case is the Closest approach (pair)
  card; the operational path is Catalog ingestion & screening -> Per-event Pc &
  B-plane -> Watchlist.
- Inputs: the closest-approach pair card takes a configurable position sigma and
  combined hard-body radius. The screening path takes a pasted CCSDS CDM / OEM / TLE
  catalog plus a threshold and sieve pad.
- Computes: time of closest approach, miss distance, relative speed, and the 2D
  probability of collision for the pair card; an all-vs-all screen, then per selected
  event the full-covariance Pc and the Alfano Max-Pc with a B-plane plot.
- Engine: `@bessel/conjunction` (rectilinear closest approach; Foster 2D Pc; full
  2x2-covariance Pc (Mahalanobis); B-plane projection; Alfano maximum Pc; STM
  covariance propagation to the time of closest approach; all-vs-all screening
  `screenAllVsAll`). Screening runs off the main thread in a dedicated (single) Web
  Worker with progress and cancel (`apps/web/src/screening.worker.ts`) over a REAL
  ingested catalog (parsed via `@bessel/interop` / `@bessel/propagator`).
- Validation: Pc against the analytic centered-circular form.
- Limits: when the ingested catalog (OEM or TLE) carries no covariance for a pair, the
  per-event card reports only the Max-Pc bound until an assumed covariance is supplied
  through the covariance-input form.

### Walker constellation design
- Workbench: the Coverage & Constellation tab, the Walker constellation card feeding
  the Coverage sweep card.
- Inputs: a configurable Walker T/P/F pattern (total satellites, planes, phasing,
  inclination, altitude); the run is gated on a buildable T/P.
- Computes: the generated constellation structure (planes, satellites per plane); it
  renders as orbit rings and publishes its members as the swept asset set.
- Engine: `@bessel/coverage` (`walkerConstellation`).
- The Coverage sweep card then runs `sweepCoverageGrid` (with area-weighted FOM and
  revisit/response-time statistics) over the asset set on a dedicated, cancellable
  coverage worker, coloring a metric-aware camera-relative contour overlay on the
  globe with a legend and a regional FOM summary table.

### Attitude slew
- Inputs: a slew from a nadir-pointing to a Sun-pointing attitude at the current
  epoch, honoring a 2 deg/s max rate and 0.5 deg/s^2 max acceleration.
- Computes: the eigen-axis slew angle (deg) over time.
- Engine: `@bessel/attitude` (two-vector laws via `twovec`, eigen-axis slew).

### Lambert transfer + porkchop
- Workbench: the Orbit & Maneuver tab, the Lambert transfer + porkchop card.
- Inputs: configurable departure and arrival bodies, a departure-window day range, and
  a time-of-flight day range (the legacy single quarter-revolution solve stays
  available below the sweep).
- Computes: a bounded departure x time-of-flight sweep solving Lambert at each node,
  rendered as a departure-delta-v contour with the minimum marked; the marked optimum
  can be sent to the editable MCS as a new maneuver.
- Engine: `@bessel/mission` (universal-variable Lambert). The sweep runs on a
  dedicated, cancellable porkchop worker (`apps/web/src/porkchop.worker.ts`).
- Validation: Lambert against Vallado example 7-5.

### Ground track
- Inputs: the spacecraft sub-point in the central body's body-fixed frame over a
  day.
- Computes: the sub-spacecraft longitude/latitude track on a 2D map.
- Engine: the `evalSeries` `subPointLonLat` provider; projected by
  `@bessel/map-projection` in the `GroundTrackMap` overlay.
- Validation: Web Mercator against EPSG:3857.

### Export CCSDS OEM
- Inputs: the spacecraft trajectory over the loaded window (sampled).
- Computes: a CCSDS Orbit Ephemeris Message (KVN) file, downloaded.
- Engine: `@bessel/interop` (`writeOem`, round-trip tested against `parseOem`).

---

## Propagate menu

### Propagate orbit (SGP4)
- Workbench: the Orbit & Maneuver tab, the Propagate orbit (SGP4 / HPOP) card.
- Inputs: the editable spacecraft source set on the card (a pasted, parsed and
  validated two-line element set), not a bundled sample.
- Computes: SGP4 over the span, published as an in-memory SPK Type-13 segment; read
  back as an altitude time series, a ground track, and the orbit period.
- Engine: `@bessel/propagator` (SGP4) plus `publishEphemeris` (`spkw13`).
- Validation: SGP4 against the AIAA-2006-6753 SGP4-VER reference vectors
  (sub-meter); the publish round-trip reproduces the SGP4 state via `spkezr`.
- Limits: near-Earth SGP4 only (no deep-space SDP4); TEME published as J2000.

### Ground-station access
- Workbench: a built-in shortcut on the Propagate orbit card (the "Ground-station
  access (Goldstone, 10 deg, sunlit)" button), distinct from the registry-driven
  Station passes card on the Access & Comms tab.
- Inputs: the propagated satellite, a Goldstone-class station, a 10 deg elevation
  mask intersected with a geocentric range gate; a 12-hour span at a 2-minute
  step.
- Computes: the visible-pass intervals and a figure of merit (pass count,
  coverage percent).
- Engine: `@bessel/access` (`computeElevationAccess` + `gfdist`, intersected with
  the window algebra) and `@bessel/coverage`.
- Validation: elevation access against solar rise/set at a known mask.

### Propagate numerically (HPOP)
- Workbench: the same Propagate orbit (SGP4 / HPOP) card; HPOP also accepts a
  scene-object source (its osculating state).
- Inputs: the spacecraft source's initial state, integrated over the span, plus a
  force-model selector (point-mass / J2 / NxN gravity / drag / SRP) and a frame note.
- Computes: a numerical altitude time series, to compare against SGP4.
- Engine: `@bessel/propagator` Cowell propagator (adaptive Dormand-Prince 5(4))
  with the selected force model (point-mass, zonal/NxN spherical harmonics,
  atmospheric drag, or solar radiation pressure).
- Validation: the integrator reproduces CSPICE `prop2b` for a pure point-mass to
  sub-meter; point-mass + J2 reproduces the analytic J2 secular drift
  (`secularRatesJ2`); SGP4 output is placed in J2000 via the TEME to J2000 transform.

---

## Mission Design menu

### Mission Control Sequence
- Workbench: the Orbit & Maneuver tab, the Mission control sequence card.
- Inputs: an editable, ordered segment list (InitialState / Propagate / Maneuver /
  Target) built in the segment editor (add, edit each segment's key parameters,
  reorder, remove), plus the target goal for the differential corrector. A porkchop
  optimum or a conjunction avoidance burn can be sent in as a Maneuver segment.
- Computes: runs the MCS through `@bessel/propagator` `runMission`, renders the
  resulting trajectory in the 3D scene (camera-relative), and shows the final state, an
  altitude chart, and the corrector convergence (`DcReport`).
- Engine: the Astrogator-class MCS executor and its differential corrector (with an
  STM-analytic or finite-difference Jacobian, nested targeting, finite burns, and an
  optional fuel-optimal gradient optimizer).
- Limits: the editor exposes the four common segment kinds; the underlying executor
  supports arbitrary nested sequences authored as the `Mcs` IR.

---

## Orbit Determination menu

### Batch least-squares estimate
- Inputs: a measurement-noise level for a synthetic tracking pass.
- Computes: synthesizes range/range-rate/angle measurements from a known truth
  orbit, runs the batch least-squares estimator, and shows the estimated state, the
  residual RMS, and the solution covariance.
- Engine: `@bessel/od` (Gauss-Newton batch LS seeded by the propagator STM; also
  provides an EKF, light-time/aberration, and consider parameters).
- Limits: the panel runs a synthetic-truth demo; the estimator accepts real
  measurement sets through its API.

---

## Report menu

### Report workbench
- Inputs: a provider (`range`, `rangeRate`, `speed`, `position`, `velocity`,
  `subPointLonLat`), an observer and target (from the loaded objects), a reference
  frame, and a time grid (duration and step).
- Computes: one cancellable `evalSeries` job over the SPICE worker, returning a
  unit-tagged report table (downsampled for display, the full series retained for
  export) and a CSV.
- Engine: the F3 EvalSpec interpreter and the unit-tagged `PROVIDER_CATALOG` in
  `@bessel/spice`; CSV via `@bessel/interop`.
- Limits: the duration is capped (defense against a runaway grid); heavier sweeps
  run on the dedicated SPICE compute worker.

---

## Reading results and exports

- Charts and tables display in the analysis units shown in the column headers
  (km, km/s, dB, deg, rad). The Report table downsamples for display but exports
  the full series.
- CSV files are RFC 4180 with formula-injection neutralization. CCSDS OEM exports
  are KVN and round-trip through the parser.
- Validation provenance for each engine is collected in REFERENCES.md; the
  per-domain validation and the remaining gaps are in docs/STK_PARITY_SPEC.md.

## Headless automation (batch runner)

The same engines run without the app. `@bessel/sdk` exposes a JSON batch-job IR (and
a `defineJob` builder) and a deterministic `runJob` runner; `apps/cli` wraps it as the
`bessel` command, injecting the Node PAL (`@bessel/pal-node`).

A job declares its satellites and a list of operations (furnish kernels, load a
catalog, propagate with SGP4 or two-body, run a Mission Control Sequence, analyze
range/eclipse/access/link-budget, reduce a report, and export OEM/CSV), plus an output
directory. Kernels resolve from the job file's directory; artifacts are written under
the output directory. Exit codes are CI-grade: 0 ok, 1 stopped on a failure, 2 an
invalid job, 3 completed with per-op failures, 4 a usage error.

```sh
bessel validate mission.job.json     # structural check only, exit 0 or 2
bessel run mission.job.json --out ./artifacts
```

The same job is byte-for-byte reproducible across runs, and `runJob` returns a
provenance manifest digesting every kernel and output (sha256). The MCS path (an
Astrogator-class mission sequence with a differential corrector, nested targeting,
and finite burns), the numerical substrate (dense output, event detection, the State
Transition Matrix), the NxN-gravity/drag/SRP force models, and the TEME to J2000
transform all live in `@bessel/propagator`; orbit determination (batch least-squares
and an EKF) lives in `@bessel/od`. See their READMEs and docs/STK_PARITY_SPEC.md
Section 9.
