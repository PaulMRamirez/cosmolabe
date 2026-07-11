# Bessel ↔ Ansys STK Premium (Space): Gap Analysis & Capability Specification

Status: Draft for review (2026-06-16). Owner: TBD. This document is a NEW
specification; it does not amend SPEC.md or any ADR. It defines the capability
gaps between Bessel today and Ansys STK Premium (Space), and specifies the work
to close (and selectively surpass) them in a way that fits Bessel's open,
SPICE-aware, web/WASM architecture.

Sourcing note: the STK baseline below is grounded in the Ansys/AGI STK product
and help documentation and the STK module set (Astrogator, Coverage/SatPro,
Communications, Radar, Conjunction/CAT, Analysis Workbench). The STK Premium
Space brochure PDF itself could not be retrieved (Ansys CDN timeouts); if it adds
specifics they should be folded into the relevant section.

---

## 1. Positioning and the core gap

STK Premium (Space) is a **mission-engineering and analysis suite** anchored by
**Astrogator** (trajectory design). Bessel today is a high-fidelity **SPICE-driven
visualization and at-epoch geometry viewer**: it consumes pre-built SPK ephemeris
(`spkpos`/`spkezr`, validated against de440), converts time and frames
(`str2et`/`et2utc`/`pxform`/`sxform`), renders FOV cones and footprints
(`getfov`/`sincpt`), computes illumination angles (`ilumin`), draws shadows, DSK
shapes, glTF spacecraft, rings, atmosphere, star fields, labels, and trajectory
polylines, and exports CZML. It has **no analytic propagators, and no
access/coverage/comm/radar/conjunction/maneuver/eclipse-interval analysis, no
time-series graphs, and no TLE/CCSDS interoperability.**

The gap is therefore not visual fidelity (Bessel already meets or beats STK's
3D viewer in places), it is the **analytical engine layer** and the
**interval/time-series substrate** that STK is built on. To surpass STK as an
open product, Bessel must add those engines natively (web/WASM/worker), reusing
CSPICE math wherever it already exists, and exceed STK on openness, scriptable
reproducibility, and zero-install multi-platform delivery (PWA + iOS + desktop).

### Scope boundary: GIS is delivered by handoff to MMGIS (not built in Bessel)

All geospatial-information-system functionality, surface mapping, terrain/imagery
basemaps, georeferenced layers, drawing/measurement on a planet surface, and
surface analysis, is delivered by **handing off to MMGIS** (the AMMOS Multi-
Mission Geographic Information System), not re-implemented in Bessel. Bessel owns
the orbital/geometry lens and produces the body-fixed products (ground tracks,
swaths, footprints, coverage grids, lat/lon results); MMGIS owns the surface. The
seam already exists (`buildMmgisUrl` / `MmgisHandoff` in `@bessel/state`): Bessel
deep-links into MMGIS with the body, time, and geometry context, and the heavy 2D
map work in §4.12 is limited to the orbital overlays (projected ground track,
swath, coverage FOM) and terrain-masked line-of-sight needed for analysis, it is
explicitly **not** a general GIS. Any requirement that drifts toward general GIS
is out of scope and routes to MMGIS.

### Design tenets carried from the existing architecture (binding)

- **Reuse CSPICE-WASM, do not reimplement physics.** The full CSPICE archive is
  already compiled to WASM; most analysis math (geometry finders `gf*`,
  occultation `occult`, two-body `prop2b`, element conversion `conics`/`oscelt`,
  illumination `illumf`, CK read/write `ckgp`/`ckw03`, SPK write `spkw09`/`13`)
  exists in the archive and only needs to be **exported and bound**.
- **Strict layering.** New analysis lives in **core** packages that depend only
  on other core packages and the `@bessel/pal` interface; never on UI/scene/shells.
- **Heavy compute in a Web Worker.** All sweeps/solves run worker-side; the main
  thread never blocks. This forces a worker-protocol upgrade (below).
- **Verifiable correctness.** Every computed quantity is asserted in a unit or
  contract test against an independent numeric reference (NAIF SPK, Vallado test
  vectors, published Pc/Lambert cases, ITU worked examples), mirroring the
  existing `spkpos` fixture test.
- **Respect the budgets.** All analysis code, data tables, and charting are
  lazy-loaded so the 350 KB gzip initial-JS budget is unaffected; the 4 MB WASM
  budget is re-measured after each export relink.

---

## 2. Capability gap matrix

| # | Domain | STK Premium (Space) baseline | Bessel today | Gap | Pri | Phase | Effort |
|---|--------|------------------------------|--------------|-----|-----|-------|--------|
| F | **Foundations** (GF exports, window algebra, worker jobs, charting) | Implicit substrate of all STK analysis | None | The entire interval/time-series substrate | P0 | 0 | L |
| 1 | **Astrodynamics & propagation** | TwoBody, J2/J4, SGP4/SDP4, HPOP (NxN gravity, drag, SRP, third-body) | SPK consumption only; 2-body osculating ring for drawing | No propagators, no TLE, no OEM/OMM | P1 | A | L |
| 2 | **Mission & maneuver design (Astrogator)** | MCS segments, Lambert, diff-correctors, optimizers, finite burns | None | Entire mission-design domain | P1 | B | XL |
| 3 | **Access / visibility / chains** | Access intervals w/ constraints; relay chains; constellations | At-epoch geometry only | No interval engine at all | P0 | A | XL |
| 4 | **Coverage & constellations (SatPro)** | Grids, Figure of Merit, Walker generation | None | No grid/FOM/constellation gen | P1 | C | XL |
| 5 | **Communications & RF** | Antennas, link budgets, ITU attenuation, Doppler, chains | None | Entire RF domain | P1 | C | XL |
| 6 | **Attitude & pointing** | Profiles, two-vector laws, slew, attitude coverage, CK/AEM | Display-only attitude (CK/quaternion/spin) | No laws, slew, constraints, coverage | P1 | B | XL |
| 7 | **Sensors & time-evolving footprints** | FOV types, targeting, swaths over time | At-epoch FOV cone + footprint | No swath/coverage/constraints; footprint in wrong layer | P1 | B | XL |
| 8 | **Conjunction / SSA (CAT)** | All-vs-all screening, Pc, covariance | None | Entire SSA domain | P2 | C | XL |
| 9 | **Lighting, eclipse & temporal geometry** | Eclipse intervals, lighting conditions, terminator | At-epoch illumination angles + shadows | No intervals, no umbra/penumbra, no terminator | P1 | B | L |
| 10 | **Reporting, graphs & Analysis Workbench** | Data providers, tables, time-series plots; Vector/Calc/Time tools | Fixed readouts, measure tool, CZML export | No providers, no time series, no charts, no workbench | P1 | B | XL |
| 11 | **Automation, SDK & interoperability** | Connect, Object Model, Python, Engine; TLE/CCSDS | BesselScript facade; Cosmographia/native catalogs; CZML | No stable SDK/BCL, no headless, no TLE/CCSDS | P1 | B | XL |
| 12 | **2D map & terrain masking** | 2D projections, ground tracks, swaths; DTED terrain mask | 3D globe only; MMGIS deep-link | No 2D map, no terrain-masked LOS | P1 | B/C | XL |

Where Bessel will **surpass** STK: open-source and Apache-2.0; zero-install PWA +
native iOS + desktop from one codebase; offline (OPFS kernel cache); a
reproducible, byte-stable headless scripting/runner (BCL) usable in CI; and a
SPICE-native data model rather than a proprietary scenario format.

---

## 3. Foundations (Phase 0), shared prerequisites

Most analysis domains depend on the same missing substrate. These foundations are
specified once here and referenced by every domain.

- **F1, CSPICE-WASM export expansion + reproducible rebuild.** Extend
  `packages/spice/scripts/build-cspice.sh` `EXPORTED_FUNCTIONS` (currently ~83
  symbols) and add typed worker bindings (`bindings.ts`) for, by domain:
  geometry finders `gfoclt_c`, `gfposc_c`, `gfdist_c`, `gfsep_c`, `gfilum_c`,
  `gfrfov_c`, `gftfov_c`; `occult_c`, `illumf_c`, `edterm_c`, `phaseq_c`,
  `et2lst_c`; two-body/elements `prop2b_c`, `conics_c`, `oscelt_c`, `oscltx_c`;
  SPK/CK writers `spkw09_c`, `spkw13_c`, `ckopn_c`, `ckw03_c`, `ckcls_c`,
  `ckgp_c`, `ckgpav_c`; vector/attitude helpers `twovec_c`, `m2q_c`, `q2m_c`,
  `eul2m_c`, `m2eul_c`, `raxisa_c`, `axisar_c`, `vsep_c`, `vrotv_c`, `ucrss_c`;
  geodesy `recgeo_c`, `recpgr_c`, `georec_c`, `latrec_c`, `recrad_c`,
  `subslr_c`, `dskx02_c`. **MUST** re-measure `pnpm size` (4 MB WASM) after each
  relink. CSPICE source is not modified (export-list + relink only).
- **F2, Interval/window substrate.** A `SpiceCell` marshaller in `@bessel/spice`
  (allocate a `SPICEDOUBLE_CELL`-equivalent in WASM memory; `ssize_c`/`scard_c`/
  `wninsd_c`/`wncard_c`/`wnfetd_c`) so GF routines can be called and their result
  windows read; and a **`SpiceWindow` interval algebra** (sorted, disjoint
  `[start,stop]` ET pairs with union/intersection/difference/complement-in-domain/
  contraction/measure) added to `@bessel/timeline`, which today holds only a
  scalar clock and annotations. This type is shared by Access, Coverage, Lighting,
  Conjunction, Attitude, and Sensors.
- **F3, Worker job protocol upgrade.** The current protocol is **single-shot
  request/response with no transferables**. Add, additively (the existing contract
  unchanged): (a) a **batched `evalSeries`** path returning column `Float64Array`
  buffers via an explicit `postMessage` transfer list (zero-copy); and (b) a
  **long-running cancellable job** lifecycle (`start(jobId)`, incremental
  `progress`, `cancel`, terminal `result`/`error`) for sweeps and solves, with a
  worker **pool** for all-vs-all screening.
- **F4, Propagation core (`@bessel/propagator`).** (The `@bessel/astro` scope in
  the original plan was folded into `@bessel/propagator`; no separate `astro`
  package was created.) Analytic
  two-body (`prop2b`/`conics`), J2/J4 mean-element, SGP4/SDP4 (Vallado
  AIAA-2006-6753), TLE parse/validate, and (Phase B) a native Cowell numerical
  integrator (RKF7(8)/DOP853, force models). Propagated arcs are published as
  in-memory SPK Type 9/13 segments so the **existing** trajectory pipeline renders
  them with no new code path. EOP (polar motion, UT1-UTC) is a new external data
  dependency required for correct TEME→J2000/ECEF; absent EOP yields a labeled
  reduced-accuracy transform, never silent full-accuracy.
- **F5, Analysis Workbench + charting surface.** A **data-provider registry**,
  a worker-side `EvalSpec` interpreter, a time-series engine, and a **net-new,
  code-split charting component** (no charting library exists in the workspace
  today). This is the reporting/graph substrate every analysis domain plots into.
- **F6, Catalog schema extensions.** `Facility`/`GroundStation` (geodetic
  position, topocentric frame, az-indexed elevation mask), `Chain`,
  `Constellation`, typed `Sensor` taxonomy, `Transmitter`/`Receiver`/`Antenna`/
  `CommLink`, and a real `TwoVector`/`Profile` attitude `Orientation` variant.
- **F7, SDK/BCL + interop.** A headless, semver-governed `@bessel/sdk` Session
  facade and the **Bessel Command Language** (BCL) discriminated-union protocol,
  plus `@bessel/interop` (TLE, CCSDS OEM/OMM/AEM/CDM, STK `.e`/`.a`).

Foundation dependency order: **F1 → F2/F3 → (F4, F5, F6) → F7**, then the analysis
domains in §4 consume them.

---

## 4. Per-domain specifications

Each requirement carries a level (MUST/SHOULD/MAY). Verification cites a concrete,
numeric-reference test in Bessel's style. Full per-requirement detail and the
critic-hardened source is retained in the workflow output; this section is the
authoritative summary.

### 4.1 Astrodynamics & Orbit Propagation, P1, Phase A, package `@bessel/propagator`

STK baseline: TwoBody, J2/J4, SGP4/SDP4 from TLE, HPOP (NxN gravity with tides,
drag Jacchia/NRLMSISE/Harris-Priester, SRP, third-body, relativity; RKF/Gauss-
Jackson), ephemeris IO (.e, OEM/OMM, SPK), EOP-aware frames.

Requirements:
- **PROP-1 (MUST)** Define a `Propagator` interface `propagate(state, etGrid) →
  EphemerisTable` (column `Float64Array`s; ET TDB, km, km/s, central body, frame).
  The raw transfer DTO lives in `@bessel/spice` (worker layer); `@bessel/propagator`
  adapts it. `@bessel/spice` MUST NOT import `@bessel/propagator`.
- **PROP-2 (MUST)** TwoBody via `prop2b_c`; state↔elements via `oscltx_c`/`conics_c`.
- **PROP-3 (MUST)** J2/J4 mean-element secular propagator from body constants via
  `bodvrd_c`/`bodvcd_c`; fail loudly if constants absent (never Earth defaults).
- **PROP-4 (MUST)** SGP4/SDP4 per Vallado revised reference, native TEME output;
  TEME→J2000 EOP-aware, reduced-accuracy-labeled when EOP unavailable.
- **PROP-5 (MUST)** NORAD TLE/3LE parse+validate (mod-10 checksum, epoch decode,
  implied decimals), typed located errors, convertible to a state at epoch.
- **PROP-6 (MUST)** Author propagated arcs as in-memory SPK Type 9/13
  (`spkopn`/`spkw09`/`spkw13`/`spkcls`) queryable via the identical `spkpos`/
  `spkezr` path (one geometry source of truth).
- **PROP-7..8 (MUST)** Run in the SPICE worker with zero-copy column transfer;
  no Three/React/PAL-impl imports.
- **PROP-9..12 (SHOULD)** CCSDS OEM/OMM round-trip; Phase-B Cowell HPOP
  (pluggable `ForceModel`: NxN gravity via Cunningham/Pines, third-body, SRP with
  SPICE-geometry shadow, drag) with RKF7(8) adaptive + dense output; bulk data
  (gravity coefficients, atmosphere indices, EOP) via PAL Storage/KernelSource.
- **PROP-13 (MUST)** Propagated/imported objects load into scene+timeline via the
  existing SPK sampler (no special-case path).

Verification: two-body one-period self-consistency; element round-trip vs a de440
seed; **SGP4 vs the AIAA-2006-6753 SGP4-VER set within published tolerance**; TEME→
J2000 vs a Vallado example vector; TLE decode + corrupted-checksum rejection; J2/J4
nodal-rate vs a sun-synchronous closed form; SPK-write contract (write→furnsh→
`spkezr` matches); OEM round-trip; zero-copy transfer-list contract; e2e: load an
ISS TLE, advance time, assert a non-empty rendered orbit.

### 4.2 Mission & Maneuver Design (Astrogator-class), P1, Phase B, packages `@bessel/mission` + `@bessel/propagator`

STK baseline: Mission Control Sequence (Initial State, Propagate, Maneuver
[impulsive/finite], Target, Hold, Backward, Stop conditions), differential
correctors and SQP optimizers, Lambert solver and porkchop search, finite-burn
pointing optimization, B-plane targeting, delta-v budgets.

Requirements (selected):
- **JOB-1 (MUST)** Worker job lifecycle (start/progress/cancel/result), the
  foundation F3 long-running half; targeting/optimization need it.
- **PROP-1/2/3 (MUST)** Analytic two-body (`prop2b`/`conics`) and a **native
  float64 Cowell integrator** (DOP853/RKF7(8), PI step control, dense output)
  with gravity-harmonic/third-body/SRP/drag force models; validated against an
  **independent** committed reference (GMAT/Horizons), not against a model it
  cannot reproduce.
- **MNVR-1/2 (MUST)** Impulsive delta-v in a selectable frame (J2000/VNB/RIC/
  LVLH); finite burns (thrust, Isp, mass flow, pointing law, throttle/duty).
- **MCS-1 (MUST)** Typed, serializable segment model + executor threading state.
- **STOP-1 (MUST)** Event stopping conditions (time, apoapsis/periapsis,
  altitude, anomaly, node, B-plane) via dense-output sign-change + Brent.
- **TGT-1 (MUST)** Differential corrector (finite-difference Jacobian + damped
  Newton); **OPT-1 (SHOULD)** SQP optimizer (min delta-v/propellant under
  constraints).
- **LAM-1 (MUST)** Izzo-2014 universal-variable multi-rev Lambert; **LAM-2
  (SHOULD)** porkchop search as a batched cancellable job.
- **BPL-1 (MUST)** B-plane (BdotR/BdotT/Btheta) as readout and targeter goal.
- **PUB-1 (MUST)** Publish converged trajectories as Type 9/13 SPK into the
  renderer. **PERF-1/BUDGET-1/FAIL-1 (MUST)** worker-side, lazy, loud failures.

Verification: two-body round-trip vs `prop2b`; perturbed propagation vs a
committed GMAT/Horizons fixture; LEO→GEO Hohmann end-to-end; maneuver-frame bases
to 1e-12; finite≈impulsive limit; backward round-trip 1e-6 km; stopping-condition
root within 1e-3 s; corrector convergence; **Lambert vs Vallado/Izzo published
cases within 1e-6 km/s**; B-plane vs published flyby; e2e: build a two-burn
targeted sequence and solve to convergence as a cancellable job.

### 4.3 Access / Visibility / Chains, P0, Phase A, package `@bessel/access`

STK baseline: access intervals between any two objects with constraint sets
(range, range-rate, elevation/azimuth, lighting, FOV, central-body/terrain
obstruction), multi-hop relay chains, constellation grouping.

Requirements (selected):
- **ACC-0 (MUST)** SpiceCell window marshaller (F2). **ACC-1 (MUST)**
  Interval/window algebra in `@bessel/timeline`. **ACC-2 (MUST)** export the
  fixed-signature GF routines (`gfoclt`, `gfposc`, `gfdist`, `gfsep`, `gfrfov`,
  `gftfov`, `gfilum`).
- **ACC-3 (MUST)** Access between any two objects over a span as a Window, with
  documented/asserted aberration default.
- **ACC-4 (MUST)** Composable constraint set as an intersection of per-constraint
  Windows: range (`gfdist`), elevation/azimuth (`gfposc` topocentric), lighting
  (`gfoclt(Sun,body)` → umbra/penumbra/sun), FOV inclusion (`gfrfov`/`gftfov`),
  LOS occultation (`gfoclt`). Range-rate is a derived constraint (LOS-projected
  relative velocity sampled+thresholded over GF candidate intervals).
- **ACC-5 (MUST)** `Facility` entity (geodetic position, topocentric frame, az
  elevation mask). **ACC-6 (MUST)** Chains (ordered hop-window intersection,
  limiting-hop attribution). **ACC-7 (SHOULD)** Constellations (any-to-any +
  at-least-one coverage window).
- **ACC-8 (MUST)** Span-scoped worker channel with progress+cancel.
  **ACC-9/10 (SHOULD)** Gantt timeline + constrained-quantity graph; CZML interval
  + CSV export. **ACC-11 (MUST)** Loud typed errors, never an empty window for a
  real failure.

Verification: SpiceCell round-trip; window-algebra vs hand-computed sets; **`gfoclt`
occultation vs a NAIF reference interval** on the Cassini/Saturn fixtures; range/
elevation sign-consistency vs independent dense sampling; three-hop chain ==
intersection of three independent strands; worker progress+cancel contract; e2e:
range+elevation produces a non-empty Gantt and a rendered link line.

### 4.4 Coverage & Constellation Design (SatPro/Coverage), P1, Phase C, package `@bessel/coverage`

STK baseline: grid/region coverage with Figure of Merit (% coverage, revisit/gap,
N-in-view, access duration, response time), Walker/train constellation generation.

Requirements (selected):
- **COV-1 (MUST)** Grid model: uniform lat/lon, equal-area (Fibonacci/geodesic)
  over a triaxial ellipsoid, and area-target polygons. **COV-2 (MUST)** consume
  the Access single-(point,asset) API (do not duplicate it).
- **COV-3 (MUST)** FOM field: % coverage, accesses, N-or-more assets, mean/max
  revisit gap, response time, time-to-first-coverage.
- **COV-4 (MUST)** Walker Delta/Star from `i:T/P/F` (RAAN 360/P, phasing 360F/T,
  in-plane 360P/T), train, custom, flown by `@bessel/propagator`.
- **COV-5 (MUST)** Cancellable worker sweep with monotonic progress; main thread
  never blocks. **COV-6 (SHOULD)** camera-relative FOM color-contour overlay in
  `@bessel/scene` (scene imports coverage *result* types only, one direction).
  **COV-7 (SHOULD)** GeoJSON/CSV + generated constellation as a native catalog.
- **COV-8/9 (MUST)** Validate propagation+access vs references; loud typed errors.

Verification: Kepler vs fixture SPK; **SGP4 vs Vallado**; Walker 53:24/3/1 ⇒ 24
assets, 3 planes, 120° RAAN, 45° phasing; FOM exact vs hand-built interval sets;
equal-area cell variance; worker progress/cancel; e2e: non-empty FOM contour over
the globe.

### 4.5 Communications & RF Link Budgets, P1, Phase C, packages `@bessel/rf` (pure) + `@bessel/analysis`

STK baseline: antenna patterns, full link budgets (EIRP, Friis, G/T, C/N0, Eb/No,
BER, margin), ITU-R attenuation, Doppler, multi-hop chains, interference; radar
adjacency.

Requirements (selected):
- **COMM-1 (MUST)** `@bessel/rf` pure unit-checked link-budget physics (no SPICE/
  Three/DOM). **COMM-2 (MUST)** antenna patterns (isotropic/parabolic/Gaussian/
  dipole/helix/tabulated) with off-axis gain. **COMM-3 (MUST)** BER(Eb/No) for
  BPSK/QPSK/M-PSK/M-QAM/FSK. **COMM-4/4b (MUST)** ITU-R P.676/P.618/P.840
  attenuation + noise-temperature roll-up into G/T.
- **COMM-5 (MUST)** Doppler shift/rate from `spkezr` (sign reconciled with the
  existing measure tool). **COMM-6 (MUST)** time-dynamic link budget sampled over
  an access interval (depends on Access §4.3).
- **COMM-7 (MUST)** catalog Transmitter/Receiver/Antenna/CommLink/GroundStation
  (antenna pointing as a SPICE frame). **COMM-8/9 (SHOULD)** multi-hop (bent-pipe
  vs regenerative), interference C/(N+I). **COMM-10 (MUST)** Link Budget panel
  (line-by-line at epoch + time-series over window) on the F5 charting surface.
  **COMM-11 (MUST)** worker bindings `gfoclt`/`recgeo`/`georec`/`azel`.
  **COMM-12 (MAY)** monostatic/bistatic radar range equation as a thin extension.

Verification: Friis at 2 GHz/40000 km to 1e-6 dB; parabolic gain/HPBW; BPSK
BER(9.6 dB)=0.5·erfc(√(10^0.96)); **ITU-R worked examples** for P.676/P.618;
Doppler vs independent `spkezr` computation; `gfoclt` vs NAIF; chain/interference
identities; e2e: open Link Budget panel, assert at-epoch budget + windowed series.

### 4.6 Attitude & Pointing, P1, Phase B, package `@bessel/attitude`

STK baseline: attitude profiles + two-vector align/constrain laws, attitude
simulator, slew profiles with rate/accel limits, constraint checking, attitude
coverage, CK/AEM IO.

Requirements (selected):
- **ATT-0 (MUST)** generic window set-algebra (F2). **ATT-1 (MUST)** two-vector
  align/constrain via `twovec_c` with a parallel-input guard. **ATT-2 (MUST)**
  profile library (Nadir/LVLH, Sun-pointing, target/track, spinning, velocity)
  with analytic angular velocity where defined.
- **ATT-3 (MUST)** profile timeline (priority overlap resolution, located gap
  errors). **ATT-4 (SHOULD)** eigen-axis slew honoring max rate/accel
  (trapezoidal/triangular, SLERP). **ATT-5 (MUST)** constraint + rate checking
  (sun/body keep-out, max body rate) → satisfied windows + coverage fraction.
- **ATT-6 (MUST)** read pointing from a loaded CK (`ckgp`/`ckgpav`, SCLK via
  `sce2c`). **ATT-7 (SHOULD)** write CK type 3 (`ckopn`/`ckw03`/`ckcls`) + CCSDS
  AEM round-trip. **ATT-8 (SHOULD)** drive sensor boresight/footprint from the
  active attitude (couples to §4.7). **ATT-9 (MUST)** worker-side.

Verification: window algebra property tests; two-vector vs a furnished TK-frame
`pxform` to 1e-9; nadir profile vs `subpnt`/`vsep`; gap/overlap errors; CK
round-trip; AEM round-trip 1e-9; 90° slew vs analytic trapezoidal to 1e-6 s;
keep-out window boundaries; e2e: switch CK→sun-pointing and assert the FOV cone
re-points.

### 4.7 Sensors & Time-evolving Footprints, P1, Phase B, package `@bessel/sensors`

STK baseline: rich FOV types (conic/rectangular/custom/SAR), targeting strategies,
sensor access with constraints, time-evolving footprints/swaths and on-ground
coverage.

Requirements (selected):
- **SENS-0 (MUST)** TS-wrap already-exported but unbound symbols (`subslr`,
  `recrad`, `reclat`, `georec`, `latrec`, `vsep`, `vnorm`, `dpr`). **SENS-1 (MUST)**
  typed Sensor schema (SimpleConic/ComplexConic/Rectangular/Custom-polygon/SAR).
- **SENS-2 (MUST)** pointing layer (Fixed/CK, Nadir, Sun-aligned, target-track,
  spin/scan) → sensor-frame rotation per epoch. **SENS-3 (MUST)** at-epoch
  point-in-FOV by **pure geometry** (LOS→sensor frame→`vsep`/half-plane/polygon),
  not requiring `gftfov`.
- **SENS-4 (MUST)** sensor Access by sampling the composite (in-FOV AND
  constraints) with bisection root-finding. **SENS-5a (MUST)** export+wrap
  `illumf` + `gfoclt`; **SENS-5b (SHOULD)** `limbpt`/`termpt`/`surfpt` for limb/
  terminator closure.
- **SENS-6 (MUST)** at-epoch footprint via `sincpt` per boundary ray, limb-closed.
  **SENS-7 (MUST)** time-evolving footprint/swath accumulation with adaptive
  temporal refinement, on an **equal-area grid** for the authoritative covered-
  area/revisit/max-gap numbers. **SENS-8 (MUST)** worker-side. **SENS-9 (MUST)**
  camera-relative FOV meshes + footprint drape + swath overlay in `@bessel/scene`
  (migrating today's shell-side `apps/web/src/instruments.ts` into core).
  **SENS-10/11 (SHOULD)** DSK targets; CZML/GeoJSON export. **SENS-12 (MAY)**
  `gftfov` as an independent validation oracle.

Verification: each new wrapper vs a NAIF value; conic boundary rays at exact
half-angle; pointing vs `subpnt`; in-FOV boundary flip to 1e-12 rad; elevation/
range window boundaries to 1e-6; nadir footprint angular radius closed-form;
**equal-area swath covered-area vs analytic spherical-cap band**; `gftfov` oracle
agreement; e2e: footprint-over-interval renders + non-empty swath.

### 4.8 Conjunction Analysis / SSA (CAT), P2, Phase C, package `@bessel/conjunction`

STK baseline: all-vs-all closest-approach screening, miss distance/TCA, covariance
propagation + probability of collision (Pc), blackout/launch/laser windows.

Requirements (selected):
- **CAT-PROP-1 (MUST)** consume SGP4 from §4.1 (do not reimplement). **CAT-EPH-1
  (MUST)** RSO catalog with per-object propagation source; ingest CCSDS OEM/OPM/
  TLE. **CAT-SCR-1 (MUST)** all-vs-all + primary-vs-catalog screening via a
  propagation callback with a coarse smart-sieve (apogee/perigee band, orbit-path
  pre-filter).
- **CAT-TCA-1 (MUST)** TCA + miss distance by relative-range-rate zero-crossing +
  derivative root-find (multi-minimum aware). **CAT-COV-1 (MUST)** 6×6 RIC
  covariance + STM propagation + B-plane projection. **CAT-PC-1 (MUST)** Pc via
  2D Foster (adaptive quadrature) + Chan analytic cross-check, with a regime
  detector falling back to Monte-Carlo/Alfano for nonlinear cases.
- **CAT-WIN-1 (SHOULD)** SPK-body separation/blackout via `gfdist`/`gfsep`.
  **CAT-OUT-1 (SHOULD)** report table + range/range-rate series + CDM-style export.
  **CAT-PERF-1 (MUST)** dedicated worker pool with cancel/progress. **CAT-FAIL-1
  (MUST)** loud typed errors (non-PD covariance, frame/time mismatch, coverage).

Verification: **SGP4 vs SGP4-VER**; two-body screen vs `spkezr`; TEME→J2000
identity round-trip; synthetic crossing TCA within 1e-3 s; sieve recall/precision;
**Pc vs the Alfano 12-case set and Foster/Hall references**; STM covariance vs
finite-difference Monte-Carlo; CDM/OEM/OPM round-trip; e2e: two crossing objects ⇒
report shows expected TCA/miss/Pc.

### 4.9 Lighting, Eclipse & Temporal Geometry, P1, Phase B, package `@bessel/events`

STK baseline: eclipse/umbra/penumbra intervals, asset lighting conditions, solar
intensity, terminator, generalized time-interval geometry constraints.

Requirements (selected):
- **LIGHT-1/2/3 (MUST)** export the GF/lighting surface (`gfoclt`, `gfilum`,
  `gfposc`, `gfsep`, `gfdist`, `occult`, `illumg`/`illumf`, `phaseq`, `edterm`,
  `et2lst`), the SpiceCell marshaller, and typed loud bindings. **LIGHT-4 (MUST)**
  `SpiceWindow` interval algebra (F2).
- **LIGHT-5 (MUST)** eclipse/lighting API for a satellite (SPK) or ground site
  (`georec`): umbra/penumbra/sun windows via `gfoclt(Sun,body)`, plus a TS
  cylindrical-shadow model (with bisection ingress/egress) since `gfoclt` is
  conical/ellipsoidal only. **LIGHT-6 (MUST)** solar-intensity time series
  (apparent solar-disk visible fraction; two-circle lens overlap, annular branch).
- **LIGHT-7 (SHOULD)** generalized occultation/transit/annular between any two
  bodies. **LIGHT-8 (SHOULD)** terminator (`edterm`) + illuminated fraction
  (`phaseq`). **LIGHT-9 (MUST)** batched worker sampling. **LIGHT-10 (SHOULD)**
  lazy lighting panel (intensity graph + interval table) on F5. **LIGHT-11
  (SHOULD)** lighting windows consumable as constraint generators by Access/
  Coverage/Conjunction via the shared `SpiceWindow`.

Verification: window-semantics contract (JS-built window AND `gfoclt` window
intersect correctly); `occult` vs a NAIF mutual-event reference; **cylindrical
umbra duration vs an analytic beta-angle LEO reference**; monotonic 0→1 penumbra
intensity; `phaseq` vs `ilumin`-derived phase; `edterm` point count + per-point
incidence; 24 h single-round-trip batch; e2e: non-empty intensity graph.

### 4.10 Reporting, Graphs & Analysis Workbench, P1, Phase B, package `@bessel/analysis`

STK baseline: Report & Graph Manager over data providers (any computed quantity as
tables/time-series with CSV export); Analysis Workbench (Vector Geometry Tool,
Calculation Tool, Time Tool) usable as constraints and report inputs.

Requirements (selected):
- **RPT-0 (MUST)** resolve the layering: the heavy `EvalSpec` interpreter runs in
  the `@bessel/spice` worker; `@bessel/analysis` holds only pure builders +
  Series assembly. **RPT-1 (MUST)** typed, unit-tagged **data-provider registry**
  (scalar/vector/quaternion/boolean over typed operands). **RPT-2 (MUST)**
  time-series engine (one batched `evalSeries` request per series → immutable
  `Series`). **RPT-3 (MUST)** Report (table) + Graph (XY) views with selectable
  units/time-format/step.
- **RPT-4 (MUST)** Vector Geometry Tool (Points/Vectors/Axes/Angles/Planes).
  **RPT-5 (MUST)** Calculation Tool (allow-listed pure scalar/boolean expression
  graph with dimensional analysis). **RPT-6 (MUST)** Time Tool (TimeInstant/
  Interval/IntervalList from absolute and scenario-relative times) usable as
  constraints.
- **RPT-7 (SHOULD)** exact constraint-crossing times (dense sampling + bisection
  primary; GF secondary). **RPT-8 (SHOULD)** persist styles+definitions in
  serializable scenario state (OPFS/URL). **RPT-9 (MUST)** everything lazy-loaded.
  **RPT-10 (MAY)** CCSDS-friendly fixed-column tabular export.

Verification: provider Range at the de440 fixture epoch matches the existing
`spkpos` assertion; RangeRate proven analytic (not series-differenced); vector
geometry vs closed-form; BetaAngle vs hand-computed r×v·Sun to 1e-9; calc-graph
boolean truth series + unknown-symbol rejection; **single-request batching
contract** (N steps × M providers ⇒ exactly one `evalSeries`).

### 4.11 Automation, SDK & Interoperability, P1, Phase B, packages `@bessel/sdk` + `@bessel/interop`

STK baseline: Connect (socket commands), Object Model, Python, headless Engine;
TLE/3LE and CCSDS OEM/OMM/AEM/CDM/TDM/VCM, STK `.e`/`.a`.

Requirements (selected):
- **SDK-1 (MUST)** typed, versioned, promise-based `Session` facade driving every
  engine operation. **SDK-2 (MUST)** headless (no DOM/Three) so it runs in a
  worker, in Node (CI/server batch), and behind the Electron bridge. **AUTO-1
  (MUST)** the **Bessel Command Language** (BCL), a JSON discriminated-union 1:1
  with SDK methods. **AUTO-2/3 (MUST)** a batch runner executing a `.bcl` script to
  completion with a machine-readable RunReport, typed event streaming, and
  non-geometry product generation.
- **INTEROP-TLE (MUST)** TLE→TEME→J2000. **INTEROP-OEM (MUST)** CCSDS OEM/OMM
  import/export (OEM→SPK via `spkw13`). **INTEROP-AEM (SHOULD)** AEM↔CK
  (`ckw03`). **INTEROP-STK (SHOULD)** STK `.e`/`.a`. **INTEROP-CDMVCM (MAY)** CDM/
  TDM/VCM parse-only.
- **SDK-PY (MUST)** re-express the Electron Python bridge as one out-of-process
  BCL transport. **SDK-STABILITY (MUST)** semver-govern SDK+BCL via changesets
  with a snapshot contract test on the public surface.

Verification: **SGP4-VER** (near-Earth + deep-space); SPK MEMFS round-trip after
adding `spkw13`; OEM→SPK interior-epoch match; OMM/AEM round-trips; BCL
encode→dispatch→result for every verb + unknown/incompatible-version rejection;
**byte-identical product hashes** on a fixture `.bcl` run twice in Node headless.

### 4.12 2D Map & Terrain Masking, P1, Phase B (map) / C (terrain), packages `@bessel/map-projection` + `@bessel/terrain`

STK baseline: 2D projected map with ground tracks/swaths/coverage overlays; DTED/
imagery terrain for terrain-masked access and LOS; integrated 2D analysis surface
beside the 3D globe.

Scope: this domain is **orbital overlays + terrain-masked LOS only**, not a GIS.
Basemaps, imagery, georeferenced layers, and surface analysis are an MMGIS handoff
(§1, §7). The DEM here exists solely to compute terrain-masked access/horizon, not
to render a map; visualization of surface context belongs to MMGIS.

Requirements (selected):
- **MAP-1 (MUST)** pure tested projections (Equirectangular, Mercator/Web Mercator,
  Polar Stereographic; Orthographic/General Perspective optional). **MAP-2 (MUST)**
  GroundTrack via `subpnt`+`recgeo`/`recpgr` with antimeridian/pole handling.
  **MAP-3 (MUST)** Swath accumulation (`getfov`+`sincpt`; `dskx02` for small
  bodies). **MAP-4 (MUST)** gridded FOM over a region (coverage fraction, N-fold,
  revisit), shares §4.4.
- **TERR-1 (MUST)** tiled body-fixed DEM via a new PAL terrain source. **TERR-2
  (MUST)** terrain-masked LOS. **TERR-3 (SHOULD)** facility horizon mask (az vs
  min-elevation) consumable by Access §4.3.
- **MAP-5 (MUST)** time-synchronized 2D view beside the 3D globe (shared timeline),
  selectable central body + toggleable layers. **MAP-6 (MUST)** geodetic readouts
  (`recgeo`/`recpgr`/`et2lst`). **MAP-7 (MUST)** lazy map/terrain chunk with its
  own size-limit entry. **MAP-8 (MAY)** extra projections + multiple 2D windows.

Verification: projection forward/inverse round-trip to tolerance; **Web Mercator
vs EPSG:3857 reference**; `recgeo` vs textbook WGS84; antimeridian/pole splitting;
ground-track vs SPICE `subpnt`; lit/dark terminator flip at incidence 90°.

---

## 5. Phased roadmap

Ordering is driven by dependencies, not domain numbering. Each phase ends green on
`pnpm verify` + `pnpm e2e` and within the size budgets.

- **Phase 0, Foundations.** F1 (GF/writer/elements WASM exports + bindings),
  F2 (SpiceCell marshaller + `SpiceWindow` algebra in `@bessel/timeline`), F3
  (batched `evalSeries` + cancellable job protocol + worker pool). Gate: contract
  tests for a marshalled window and a `gfoclt` reference interval; WASM ≤ 4 MB.
- **Phase A, Propagation + Access (the analytics beachhead).** §4.1 (`@bessel/
  astro`/`@bessel/propagator`: two-body, J2/J4, SGP4, TLE, SPK publish) and §4.3
  (`@bessel/access`: intervals + constraints + chains). These two unlock the most
  downstream value (objects-from-elements + the interval engine).
- **Phase B, Analysis core.** §4.10 (Workbench/Reporting + F5 charting, the
  surface everything plots into), §4.9 (Lighting/Eclipse), §4.6 (Attitude), §4.7
  (Sensors/Swaths), §4.2 (Mission/Astrogator, needs the numeric propagator),
  §4.11 (SDK/BCL/interop), §4.12-map (2D map).
- **Phase C, Aggregation & SSA.** §4.4 (Coverage/SatPro), §4.5 (Comms/RF), §4.8
  (Conjunction/CAT), §4.12-terrain (terrain masking). These consume Access,
  Propagation, and the charting/series surface.

Dependency highlights: Access and Lighting both rest on F1+F2; Coverage needs
Access+Propagator; Comms needs Access (+ `gfoclt`/`recgeo`); Conjunction needs
Propagation+interop; the Workbench (F5) is a prerequisite for every panel that
plots a time series.

---

## 6. Verification & acceptance philosophy

- Every physics result is pinned to an **independent numeric reference**: NAIF SPK
  values (the existing `spkpos` fixture pattern), the Vallado SGP4-VER set, the
  Izzo/Vallado Lambert cases, the Alfano/Foster Pc benchmarks, ITU-R worked
  examples, EPSG:3857 reference points, and committed GMAT/Horizons fixtures for
  perturbed propagation.
- Behavior is asserted by **Playwright e2e** on fixtures (non-empty WebGL frame,
  non-empty graph canvas, populated report rows), never by judgement.
- **Worker contracts** assert batching, progress, and cancellation.
- **Budgets** are gates: lazy chunks keep initial JS ≤ 350 KB gzip; each WASM
  relink re-measures ≤ 4 MB; new data tables (gravity coefficients, ITU tables,
  DEM tiles) arrive via the PAL as kernels-as-data, never bundled.

---

## 7. Non-goals / explicit scope boundaries

To surpass STK *for an open mission-visualization-and-analysis product* without
chasing every STK SKU:

- **Not** STK Aviator (atmospheric flight), EOIR/high-fidelity sensor radiometry,
  or classified/ITAR-restricted models.
- **HPOP fidelity is staged.** Phase-A propagation is analytic (two-body/J2/SGP4);
  full numerical HPOP with NxN gravity + drag + SRP + tides is Phase B/C and is
  validated against an external reference rather than claiming bit-parity with
  STK's force models.
- **Radar** is a thin monostatic/bistatic range-equation adjunct (MAY), not STK's
  full SAR/clutter/jamming suite.
- **All GIS / surface functionality is an MMGIS handoff, by design** (see §1).
  Bessel's 2D work (§4.12) is limited to orbital overlays (ground track, swath,
  coverage FOM) and terrain-masked LOS for analysis; basemaps, georeferenced
  layers, and surface analysis route to MMGIS via `buildMmgisUrl`. Bessel never
  embeds a general GIS.
- **Live telemetry** stays an adapter to Yamcs/OpenMCT, not a re-implementation.

---

## 8. Backend strategy decision: NASA GMAT integration

Decision (binding for this spec): **native-only at runtime now; GMAT used offline
as a committed-fixture validation oracle and an algorithm reference; the optional
GMAT compute backend is deferred behind a decision gate, with its seam retained so
it can be added later without rework.** Bessel implements the analysis engines
natively (TypeScript + CSPICE-WASM, worker-side) per §3–§4 so the offline PWA, iOS,
and desktop targets all work with **no external runtime dependency**. NASA's GMAT
is explicitly **not** compiled into the browser and **not** a runtime dependency at
this time; it is used offline (R2/R3) and held in reserve as an optional backend
(R1).

Why defer R1 (the optional GMAT runtime backend): wiring GMAT in as a runtime
dependency is expensive and benefits only desktop/server users (GMAT cannot run in
the browser or on iOS). The costs taken on would be: per-platform packaging of a
large native app (GMAT bundles its own CSPICE, duplicating CSPICE-WASM) or a
separate-install requirement; a Python-subprocess or native-addon transport with
state/ephemeris marshalling; dependence on a GMAT API that was **beta at R2020a**
(current maturity unverified); an **unverified** ephemeris round-trip (does GMAT
write SPK/OEM back into Bessel's pipeline); and tracking GMAT's ~annual releases.
The `ComputeProvider` seam (below) costs almost nothing because the native provider
is being built anyway, so optionality is preserved cheaply without paying these
costs now.

Rationale, from the verified research (sources below):
- **License fits.** GMAT is Apache-2.0 (moved from NOSA at R2013a; current R2026a,
  NASA-GSFC maintained), so it is cleanly compatible with Bessel's Apache-2.0. (Its
  bundled third-party deps, e.g. CSPICE, carry their own licenses.)
- **A browser-side GMAT is impractical.** GMAT's engine depends on a heavy native
  stack (wxWidgets, f2c-converted Fortran, CSPICE, Xerces-C, PCRE2, SOFA, SWIG) and
  a pthreads model; Fortran→WASM via f2c needs extensive patching and threaded
  Emscripten requires SharedArrayBuffer behind cross-origin-isolation headers. A
  clean Emscripten build does not exist, so GMAT cannot be the in-browser engine
  and cannot serve the offline PWA, which is Bessel's core value. The native
  engines (§4) therefore remain the primary path.
- **GMAT shares our substrate.** It links CSPICE and consumes SPK/PCK/CK (and has
  ContactLocator/EclipseLocator that use SPICE), and since R2020a exposes a SWIG
  Python/Java/C++ API to propagation, force modeling (NxN gravity, PrinceDormand78),
  optimization (pluggable NLP solvers, e.g. SNOPT/IPOPT), and OD measurement models.
  That makes it valuable where high fidelity matters and a desktop/server is present.

Adopted roles:
- **R1 (DEFERRED, seam-only), Optional high-fidelity compute backend
  (desktop/server).** Now: introduce only the `ComputeProvider` capability on the
  **`@bessel/pal`** interface for the heavy analysis verbs (propagate,
  maneuver/targeting, orbit determination), with a single implementation, the
  native engine (`@bessel/propagator`/`@bessel/mission`), always available and
  offline. Do **not** build a GMAT provider yet. Later, if the decision gate below
  is met, an **optional** `gmat` provider (Electron desktop with a local GMAT
  install, or a server compute service) can be added behind the same seam, driving
  GMAT via its Python/C++ API and returning SPK/ephemeris tables through Bessel's
  existing SPK pipeline (PROP-6/PUB-1), with no change to callers. The PWA/iOS
  never see GMAT.
- **R2, Validation oracle via committed static fixtures (no GMAT in CI).** Generate
  reference trajectories and maneuver/OD products from GMAT **once, offline**, and
  commit them as test fixtures; CI then asserts the native engines against the
  committed references and stays GMAT-free and reproducible. Regenerate deliberately
  when the reference set needs to change. Caveat from the research: do **not** assume
  a specific published GMAT validation tolerance (a 0.05 mm/s FreeFlyer-agreement
  claim was refuted); establish Bessel's acceptance tolerances empirically against
  the committed references, alongside independent references (Vallado SGP4-VER, NAIF
  SPK, published Lambert/Pc cases).
- **R3, Algorithm and test-case reuse.** Use GMAT's documented algorithms and
  published validation cases to inform the native implementations.

Decision gate for R1 (revisit only when ALL hold): (1) a concrete user/product need
for flight-grade fidelity or orbit determination on a desktop/server target that the
native engines do not meet; (2) the current GMAT API is verified production-grade for
headless use; and (3) GMAT's ephemeris round-trip into Bessel's SPK pipeline (SPK
write and/or CCSDS OEM/AEM) is verified. Until then, R1 stays seam-only.

Scope effect on the roadmap:
- **Phase 0 and the Access/Coverage/Comms/Conjunction/Lighting/2D domains are
  unchanged.** GMAT does **not** provide access/visibility, coverage figure-of-
  merit, comms/RF, radar, large-catalog conjunction screening, or 2D mapping, so
  those remain native and the Phase 0 GF/window/worker foundations are required
  regardless.
- **Propagation (§4.1) and Maneuver/Mission design (§4.2)** are native, validated
  against committed GMAT-generated fixtures (R2) plus independent references; the
  `ComputeProvider` seam is introduced now with only the native provider (R1
  seam-only).
- **Orbit Determination** (not in the original 12 domains) is recorded as a future
  domain: a native batch-least-squares baseline, with GMAT's mature OD/estimation
  as the prime candidate for an R1 backend if the decision gate is met.

Sources (verified, primary): nasa/GMAT (github.com/nasa/GMAT; Apache-2.0 License.txt,
R2026a, depends/configure.py dependency set), NASA software catalog GSC-19640-1 /
GSC-19468-1, NTRS 20180000083 (architecture), AAS 20-580 (GMAT API), Emscripten
pthreads / web.dev WebAssembly threads / Pyodide Fortran-to-WASM notes.

---

## 9. Implementation status (2026-06-22)

The analytical **engine layer**, the actual gap vs STK, is implemented as
validated headless core packages, and the analysis layer is now surfaced into a
**task-framed, six-tab Analyze workbench** rather than the old flat
`AnalysisPanel.tsx` (deleted). The workbench tabs are **Orbit & Maneuver**,
**Lighting & Geometry**, **Access & Comms**, **Conjunction**, **Coverage &
Constellation**, and **Report & Compare**; each surfaces its analysis domain as
collapsible **TaskCards** (an intent name, a config form, a run button, and an
inline result you can Keep or Export) over a shared **Scenario context bar**
(epoch, span/step, target, observer, frame, and a first-class ground-station
registry), with an **AnalysisLauncher** search box and mission-profile **presets**
(SSA, Comms, Coverage, Mission design, Observation) as accelerators. The deep
capabilities (full-covariance Pc, B-plane, beta angle, az/el mask, sun keepout,
terrain line-of-sight, range rate, area-weighted figure of merit, modcod margin)
are parameters and toggles on intent-named tasks, not separate top-level tools.
See docs/analysis-workbench.md (structure and shared controls) and
docs/analysis-personas.md (per-perspective walkthroughs).

Every quantity is asserted against an independent numeric reference (NAIF
SPK/`occult`, Vallado SGP4-VER and Lambert, EPSG:3857, analytic Pc/eclipse/footprint
forms, ITU/textbook RF anchors). 1407 unit/contract tests and ~64 Playwright e2e
(63 chromium + the Electron DSK render); `pnpm verify` and `pnpm e2e` green; initial
JS and WASM within budget.

The numerical substrate, the higher-fidelity force models (NxN gravity, drag, SRP),
the Astrogator-class Mission Control Sequence (now with nested targeting and finite
burns), orbit determination, the EOP-aware TEME to J2000 transform, and the headless
automation SDK/BCL (the formerly pending items below) have all landed; see the
updated rows and §10.

The F3 foundation and the shadowed-core wiring are landed: the **F3 cancellable-job
protocol, EvalSpec interpreter, and worker pool** ship in `@bessel/spice`
(`eval-series.ts`, `pool.ts`) and the report and ground-track tools now run as
one-round-trip `evalSeries` jobs; the **propagator is wired into the Orbit &
Maneuver tab** (a user spacecraft source -> SGP4/HPOP -> SPK-13 -> altitude + ground
track, plus a composable ground-station access window in Access & Comms), the
**footprint moved into core `@bessel/sensors`**, and **CSV/CZML export plus a
real-data CCSDS OEM fixture** landed in `@bessel/interop`.

| Domain | Package | Status (validated cores) |
|---|---|---|
| Foundations (F1/F2/F3) | `@bessel/spice`, `@bessel/timeline` | GF + SpiceCell + propagation/attitude/SPK-write bindings, **now including the `gfsep` (angular-separation) and `gfposc` (coordinate) geometry finders** that back sun-keepout and az/el-mask access; `SpiceWindow` algebra; batched zero-copy `spkposBatch`; **F3 EvalSpec interpreter + cancellable-job protocol + worker pool** (partition a sweep across workers). **Done.** |
| Propagation | `@bessel/propagator` | TLE parse (vs Vallado), **SGP4 (vs SGP4-VER, sub-meter)**, two-body (`prop2b`), J2/J4 mean-element, SPK Type-13 publish, batch, **a native Cowell HPOP: adaptive DOPRI5 integrator + pluggable ForceModel, validated against prop2b (sub-meter) and secularRatesJ2; the force model spans point-mass, full NxN spherical harmonics (sectoral + tesseral, Cunningham/Gottlieb recursion), third-body, atmospheric drag (co-rotating, pluggable exponential density), and cannonball solar radiation pressure with cylindrical shadow; drag density is pluggable behind a `DensityModel` seam with an exponential model, a Harris-Priester (Montenbruck & Gill Table 3.8, diurnal bulge) model, and an F10.7/Ap-driven Jacchia-1971 thermospheric model (vs the SatelliteToolbox jr1971 reference)**, **plus the numerical substrate: dense (continuous Hermite) output, switching-function event detection with Brent root-finding and terminal stops, and the co-integrated 42-state variational State Transition Matrix (`propagateCowellEx`, `dense.ts`, `events.ts`, `stm.ts`)**. **Done + UI** (the Orbit & Maneuver tab, Propagate orbit card: SGP4 and HPOP both render altitude/ground-track from a USER spacecraft source (paste a TLE or pick a scene object; the former hardcoded `SAMPLE_TLE` was deleted) with a point-mass/J2/NxN/drag/SRP force-model selector; publish pipeline tested). The full multi-species NRLMSISE-00 is pending (Jacchia-1971 is the driver-aware MSIS-class model in place). |
| Mission Control Sequence | `@bessel/propagator` (`mcs/`) | **Astrogator-class MCS: a pure JSON mission IR (InitialState/Propagate/Maneuver/Target/Sequence/Stop), an immutable executor reusing `propagateCowellEx` with event-driven stop conditions, impulsive VNB/inertial burns AND finite (continuous-thrust) burns with co-integrated mass depletion, and a differential corrector with an STM-analytic Jacobian (zero finite-difference when STM-served + analytic goal + fixed-time stop) falling back to finite difference, with damped Newton, trust region, NESTED multi-level targeting, and loud typed failures**. Validated against the vis-viva delta-v, a flight-path-angle null, a pure-STM downrange-radius oracle, the rocket-equation/impulsive-limit for finite burns, and a nested inner/outer corrector. An OPTIMIZER mode (`minimizeDeltaV`) offers both a projected-gradient (reduced-gradient) method and a higher-order SQP (sequential quadratic programming) method with constraint restoration over a redundant control set, both validated to the closed-form Hohmann tangential-burn optimum (SQP converging in fewer outer iterations). **Core done + UI** (the Orbit & Maneuver tab, Mission control sequence card: an EDITABLE segment builder, add/edit/reorder/remove InitialState / Propagate / Maneuver / Target segments, run the differential corrector to residual convergence, and render the solved arc + corrector convergence in 3D). A full SNOPT-class active-set/interior-point solver is pending. |
| Frames | `@bessel/propagator` (`frames/`) | **EOP-aware TEME to J2000 (EME2000/GCRF): IAU-1976 precession, the full 106-term IAU-1980 nutation, the equation of the equinoxes, and the celestial-pole offset (ddpsi/ddeps) corrections**, validated to sub-meter against the Vallado teme2eci worked example. **Core done** (wired into the SDK SGP4 propagate path). |
| Access | `@bessel/access` | Line-of-sight (`gfoclt`), range (`gfdist`), chains, facility elevation, **plus a range-rate constraint (LOS-projected relative velocity), an az/el-mask station constraint via `gfposc`, a sun-exclusion keepout via `gfsep`, and a terrain-masked LOS constraint over a DEM source**. **Done + UI** (the Access & Comms tab: a composable constraint-stack form, line of sight / range / range rate / sun keepout / az-el mask / terrain, with a per-constraint breakdown of what each constraint alone admits; a first-class ground-station registry with az/el-mask station passes (rise/set, max elevation); in-FOV windows with a selectable pointing mode; slew feasibility between consecutive passes; and a conflict-free, slew-feasible multi-target observation schedule). |
| Lighting/eclipse | `@bessel/events` | Umbra/penumbra/annular/sunlit (vs `occult`), **plus a solar beta-angle series and a solar-intensity / penumbra-fraction (visible solar-disk fraction) series**. **Done + UI** (the Lighting & Geometry tab: beta-angle season against the eclipse-onset threshold, four-phase eclipse windows with per-day duration, and solar-intensity cards). |
| Mission/maneuver | `@bessel/mission`, `@bessel/propagator` (`mcs/`) | Lambert (vs Vallado 7-5), impulsive maneuvers in VNB/RIC/LVLH. **Core done + UI** (the Orbit & Maneuver tab, Lambert transfer + porkchop card: a configurable departure x time-of-flight delta-v contour swept on a worker, with the minimum marked and a send-to-MCS handoff). The MCS executor + differential corrector (above) now provides Astrogator-class targeting. |
| Coverage | `@bessel/coverage` | Figure-of-Merit reduction, Walker generation, a lat/lon grid-sweep over access (`sweepCoverageGrid`): per-cell access time, revisit, and exact N-fold simultaneous coverage reduced to a FOM grid, reusing `@bessel/access` per cell, **plus revisit / response-time and access-duration statistics, an area-weighted FOM, and a metric-aware contour overlay**. **Core done + UI** (the Coverage & Constellation tab: the Walker designer publishes its members as the swept asset set; a worker-backed grid sweep colors a metric-aware contour with a legend and a regional FOM summary table + CSV). |
| Comms/RF | `@bessel/rf` | Friis, antenna gain, BER, link budget, Doppler, ITU-R rain (P.618/P.838) + gaseous slant-path attenuation, a typed comm-entity schema (Transmitter/Receiver/Antenna -> EIRP, G/T), **plus an off-axis antenna pattern with pointing loss, a polarization-mismatch loss, a rain sky-noise temperature, and M-PSK / M-QAM BER with a modcod table**. **Done + UI** (the Access & Comms tab: a downlink Eb/N0 chart, plus an itemized line-by-line link-budget worksheet, EIRP through margin, with a selectable modcod and a margin-vs-time threshold, bound to a selected station pass). Full P.676 line-by-line pending. |
| Attitude | `@bessel/attitude`, `@bessel/interop` | Two-vector laws (`twovec`), eigen-axis slew, **pointing keep-out (exclusion) constraints with a windowed analysis, plus an attitude read/write path: AEM write (`writeAem`, round-trips `parseAem` scalar-first) and an `attitudeHistory` / `pxformAt` body-orientation sampler (the CK Type 3 analog), with `quaternionToMatrix` pinned against CSPICE `q2m`; plus CK-binary write/read now that CSPICE-WASM exports `ckw03`/`ckopn`/`ckcls`/`ckgp`/`sce2c`/`sct2e` (`@bessel/spice`), validated by a write/`ckgp`/`pxform` round-trip against `q2m` and wired into the viewer's CK-driven attitude demo**. **Core done + UI** (the Orbit & Maneuver tab's Attitude slew card: an eigen-axis slew profile between two pointing modes; plus the bundled CK-driven spacecraft attitude). |
| Sensors | `@bessel/sensors` | Conic FOV in/out, boundary, footprint on a body, the SPICE ellipsoid footprint + FOV cone (moved into core), **plus a typed sensor schema and time-evolving swath accumulation + coverage metric**. **Core done + UI** (FOV cone + footprint render in-scene; the Access & Comms tab's in-FOV observation windows expose a SELECTABLE pointing mode). Rectangular FOV + spherical-polygon swath union pending. |
| Conjunction/SSA | `@bessel/conjunction` | 2D Pc (Foster, vs analytic), TCA/miss, all-vs-all screening (`screenAllVsAll`): a two-stage smart sieve (apogee/perigee radial-shell band + a coarse conjunction-box) before fine TCA/miss/Pc refinement of flagged pairs (validated to flag exactly a known crossing pair against decoys), **plus full-covariance Pc via the Mahalanobis encounter-plane integral, a B-plane (encounter-plane) projection, a Max-Pc (Alfano) bound, and 6x6 covariance STM propagation to TCA (Monte-Carlo validated)**. **Core done + UI** (the Conjunction tab: ingest a real pasted CCSDS CDM / CCSDS OEM / TLE set via `@bessel/interop` + the propagator, run an all-vs-all screen on a cancellable worker, read a Pc-colored sortable event table, click a row for the full-covariance Pc + Max-Pc + an SVG B-plane plot, supply explicit RTN/inertial covariance when the catalog carried none, plan an avoidance burn into the MCS, screen-after-maneuver for a before/after Pc, track a watchlist, and export a CDM). |
| Orbit determination | `@bessel/od` | **A Gauss-Newton batch least-squares estimator and a sequential extended Kalman filter (Joseph-form update), with analytic range, range-rate, and angle (RA/Dec, Az/El) measurement models, seeded by the propagator STM (`H_i = (dh/dx)_i Phi(t_i, t0)`); returns the estimated state, covariance, and residual RMS, with loud typed failures**. Validated against a synthetic-truth oracle: perfect measurements recover the truth state to sub-meter / sub-mm-per-s, a noisy case stays within covariance bounds, and measurement partials match finite differences. **Light-time/aberration** (`predictLightTime`, iterated down-leg solve with the STM-referred Jacobian) and **consider parameters** (a `consider`-covariance augmentation `Pc = Pxx + Sxc Pcc Sxc^T`), **Bennett tropospheric refraction** in the elevation/angle model, and **state-noise compensation (SNC) process noise** in the EKF (which keeps the filter consistent on a mismodeled truth where the no-Q filter diverges) have all landed. **Core done + UI** (the Orbit & Maneuver tab's Orbit determination card: estimate from synthetic tracking, show state, residual RMS, and covariance). |
| Reporting/Workbench | `@bessel/analysis`, `@bessel/spice` | Vector-geometry tool, data-provider series + stats, **plus a unit-tagged provider registry (`PROVIDER_CATALOG`) + the F3 EvalSpec interpreter**. **Core done + UI** (the Report & Compare tab's Data-provider report card: pick a provider + observer/target + grid, run one evalSeries job, read a `ReportTable`, export CSV; plus the charting primitives and the whole-variant compare tray). Calculation/Time derived-column tools pending. |
| Interop | `@bessel/interop`, `@bessel/propagator` | CCSDS **OEM** parse/write (+ real-data MGS fixture) and **OEM->SPK import** (`publishOem`, renders via spkpos), **OMM** parse + `ommToTle` (drives SGP4, validated vs the catalog-5 TLE), **CDM** parse (SSA), **AEM** parse (attitude; quaternion records normalized scalar-first), **CSV and CZML export**. Frame/time: **recgeo + et2lst bindings**. **Core done + UI** (the Report & Compare tab's Export trajectory (OEM) card; per-result CSV export across the workbench; CDM ingest/export in the Conjunction tab). The EOP-aware TEME->J2000 transform (Frames row) and the automation SDK/BCL (Automation row) have since landed. |
| Automation/BCL | `@bessel/sdk`, `@bessel/pal-node`, `apps/cli` | **A headless, deterministic batch runner: a schema-validated JSON batch-job IR + `defineJob` builder, and `runJob` (3-pass validate/reference/execute) over furnish/loadCatalog/propagate(sgp4 with TEME->J2000, twobody)/runMcs/analyze(range, eclipse, access, linkBudget)/report/exportOem/exportCsv, with CI-grade exit codes and a provenance manifest (sha256 kernel and output digests, canonical JSON)**, a shipped JSON Schema kept in lockstep with the hand validator, an in-memory test PAL, a Node directory PAL (`@bessel/pal-node`), and the `bessel` CLI. **Core done** (each op end-to-end tested with the real SPICE engine and byte-stable output). Coverage/conjunction ops and a live provenance dashboard pending. |
| 2D map | `@bessel/map-projection` | Equirectangular, Web Mercator (vs EPSG:3857), polar stereographic. **Done + UI** (the Lighting & Geometry tab's ground-track map: a SELECTABLE projection, equirectangular / Web Mercator / polar stereographic, with the scenario ground stations draped as overlay markers in the same projection). |
| Terrain | `@bessel/terrain` | Terrain-masked line-of-sight. **Core done + UI** (now SURFACED as a terrain-masked-LOS access constraint over a sample DEM source in the Access & Comms constraint stack). |

UI surfacing is **complete for every Phase B/C analysis domain**, now consolidated
into the single task-framed six-tab Analyze workbench (the old flat
`AnalysisPanel.tsx` is deleted). The charting primitives (`IntervalTimeline` Gantt,
`TimeSeriesChart`, `GroundTrackMap`, spec F5) ship in `@bessel/ui`, and the workbench
surfaces every analysis domain as configurable TaskCards over the engine and
lazy-ops seam, with:

- **whole-variant Compare**, the compare tray on Report & Compare tabulates kept
  snapshots side by side, grouped by domain, across access, link, conjunction,
  coverage, orbit, and lighting;
- **active-selection bindings**, a selected station pass binds the link-budget
  worksheet, a consecutive pass pair feeds the slew check, and a screened event
  drives the Pc / B-plane view;
- **cross-tab carriers**, an OD covariance feeds the Conjunction covariance input,
  and a conjunction event plans an avoidance burn into the MCS;
- a **unified export** (CSV with a run-metadata header, OEM trajectory, link
  worksheet CSV, coverage FOM CSV, and a CCSDS-CDM record); and
- dedicated **cancellable worker chunks** for catalog screening, the coverage grid
  sweep, and the porkchop sweep, each with its own size budget.

These are proven end-to-end by the workbench e2e suite (`e2e/tests/workbench.spec.ts`,
`context.spec.ts`, the `mission-design`/`od`/`propagate`/`report` specs, and the
per-domain flows in `e2e/tests/analysis.spec.ts`, which now cover lighting, the
access constraint stack, conjunction CDM ingest + full-covariance Pc, the worker
coverage-grid sweep, maneuver/map plots, in-FOV windows, the terrain-LOS constraint,
and the multi-target observation schedule), exercising the interval (window-algebra)
and sampled (batched-ephemeris) engine paths, the scalar-readout and file-export
paths, and the worker job paths.

The F3 cancellable-job worker pool, OMM/CDM interop, time-evolving sensor swaths,
attitude pointing keep-out, the integrator substrate (dense output + event
detection + STM), the higher-fidelity force models (NxN spherical harmonics, drag,
SRP), the Astrogator-class MCS + differential corrector (with nested targeting,
finite burns, and a projected-gradient optimizer), orbit determination (batch LS +
EKF, with light-time and consider parameters), all-vs-all conjunction screening, the
coverage grid-sweep, the AEM/CK-analog attitude read/write, the EOP-aware TEME->J2000
transform, and the headless automation SDK/BCL have all since landed, the MCS,
OD, and HPOP engines are surfaced in the app UI, and the Jacchia-1971 driver-aware
drag model, the SQP optimizer, OD Bennett refraction + SNC process noise, and
CK-binary write/read (CSPICE-WASM relinked with the `ck*`/`sce2c` exports) have all
since landed too (see the rows above). Remaining (deeper per-domain features, each
its own focused effort): the full multi-species NRLMSISE-00 model and a SNOPT-class
active-set/interior-point optimizer (propagator/mcs), and richer OD measurement
modeling (ionospheric delay, multi-arc). GMAT remains seam-only per §8.

---

## 10. New packages introduced (summary)

`@bessel/propagator`, `@bessel/access`, `@bessel/coverage`,
`@bessel/rf`, `@bessel/analysis`, `@bessel/attitude`, `@bessel/sensors`,
`@bessel/conjunction`, `@bessel/events`, `@bessel/interop`,
`@bessel/map-projection`, `@bessel/terrain`, **`@bessel/od`** (orbit determination:
batch least-squares + EKF), and **`@bessel/sdk`** (the headless automation runner;
the planned `@bessel/astro` folded into `@bessel/propagator`, which also now hosts
the MCS executor, the TEME->J2000 frames, and the NxN-gravity/drag/SRP force terms),
all core-layer, depending only on
other core packages and `@bessel/pal`, lazy-loaded, worker-backed where they
compute. The PAL gained a headless Node implementation **`@bessel/pal-node`** and a
new shell **`apps/cli`** (the `bessel` batch runner). Existing packages extended:
`@bessel/spice` (exports + bindings + worker
protocol), `@bessel/timeline` (window algebra), `@bessel/catalog` (facility/
sensor/comm/attitude schema), `@bessel/scene` (FOM/swath/terminator overlays),
`@bessel/ui` (charting + analysis panels), `@bessel/state` (export + persistence),
and **`@bessel/pal`** (a new `ComputeProvider` capability, native by default, with
an optional desktop/server GMAT provider per §8).
