# Changelog

All notable changes to Bessel are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-release entries are aggregated from the Changesets under `.changeset/` by the
release pipeline (`pnpm release:dry` previews it); the Unreleased section below is
maintained alongside them, not hand-edited per package.

## [Unreleased]

### Added

- Mission-analysis engine layer, surfaced in three viewer workbenches:
  - Analysis menu: eclipse/umbra intervals, range time series, Sun line-of-sight
    access with a coverage figure of merit, downlink Eb/N0 link budget,
    conjunction time-of-closest-approach and 2D probability of collision,
    Walker-Delta constellation design, eigen-axis attitude slew, Lambert transfer
    delta-v, ground track, and CCSDS OEM export, each with CSV export.
  - Propagate menu: SGP4 propagation of a sample TLE into an in-memory SPK with
    altitude/ground-track readback, ground-station access, and a native Cowell
    HPOP (adaptive DOPRI5 with a point-mass + J2 force model).
  - Report workbench: a unit-tagged data-provider registry driving cancellable
    `evalSeries` jobs into report tables and CSV.
- New core analysis packages: `@bessel/propagator`, `od`, `access`, `events`, `rf`,
  `coverage`, `conjunction`, `attitude`, `sensors`, `mission`, `map-projection`,
  `interop`, `analysis`, and `terrain`.
- Numerical substrate in `@bessel/propagator`: dense (continuous Hermite) output,
  switching-function event detection with terminal stops, and the co-integrated
  42-state variational State Transition Matrix (`propagateCowellEx`).
- Higher-fidelity Cowell force models in `@bessel/propagator`: full NxN spherical
  harmonics (sectoral and tesseral), atmospheric drag (co-rotating, with both an
  exponential and a Harris-Priester density model behind the `DensityModel` seam),
  and cannonball solar radiation pressure with a cylindrical shadow, alongside the
  existing point-mass, zonal, and third-body terms.
- Astrogator-class Mission Control Sequence in `@bessel/propagator` (`mcs/`): a pure
  JSON mission IR, an immutable executor, and a differential corrector with an
  STM-analytic (else finite-difference) Jacobian and damped Newton solve, including
  nested multi-level targeting, finite (continuous-thrust) burns with mass depletion,
  and a projected-gradient optimizer mode for fuel-optimal targeting.
- Orbit determination in the new `@bessel/od`: a Gauss-Newton batch least-squares
  estimator and a sequential extended Kalman filter, with range, range-rate, and
  angle measurement models seeded by the propagator State Transition Matrix, plus
  light-time/aberration and consider-parameter covariance.
- Additional analysis-engine coverage: all-vs-all conjunction screening with a
  smart sieve (`@bessel/conjunction`), a lat/lon coverage grid-sweep over access
  (`@bessel/coverage`), and an attitude read/write path (AEM write and an
  `attitudeHistory`/`pxformAt` sampler in `@bessel/interop`/`@bessel/attitude`).
- EOP-aware TEME to J2000 (EME2000/GCRF) transform in `@bessel/propagator`
  (`frames/`): IAU-1976 precession, the full IAU-1980 nutation, and celestial-pole
  offsets, validated to sub-meter against the Vallado worked example.
- Headless automation: `@bessel/sdk` (a JSON batch-job IR, a `defineJob` builder, a
  deterministic `runJob` runner with CI-grade exit codes and a provenance manifest,
  ops for furnish/loadCatalog/propagate/runMcs/analyze[range, eclipse, access,
  linkBudget]/report/export, and a shipped JSON Schema), `@bessel/pal-node` (Node
  kernel source plus a confined writer), and `apps/cli` (the `bessel` batch runner,
  bundled to a runnable Node binary via `pnpm build:cli`).
- App workbenches surfacing the numerical engines: a Mission Design panel (build and
  run an MCS, render the arc and corrector convergence), an Orbit Determination panel
  (estimate a state with residual RMS and covariance), and an HPOP force-model
  selector in the Propagate panel. Each is proven by a Playwright e2e and passes the
  axe accessibility scan.
- Cosmographia visual and interaction parity (grounded by research against
  cosmoguide.org and the claurel/cosmographia source): ring image textures (the v=0
  radial-strip mapping) plus night/specular/cloud body materials; an in-app scripting
  console over `BesselScript` (a no-eval line grammar with the cosmoscripting verb
  set); a plugin-loader menu over `PluginRegistry` that furnishes kernels in add-on
  order; SPICE-derived timeline event annotations; a predicted-versus-actual telemetry
  overlay (OpenMCT/Yamcs idioms); and real bundled-demo spacecraft attitude via a
  UniformRotation orientation.
- CK (C-kernel) attitude read/write: CSPICE-WASM relinked to export
  `ckw03`/`ckopn`/`ckcls`/`ckgp`/`sce2c`/`sct2e`; the engine writes and reads
  C-kernels and the bundled Cassini demo shows real CK-driven attitude (validated by
  a write/`ckgp`/`pxform` round-trip against `q2m`).
- Runtime planetary imagery: a texture manager fetches real equirectangular
  basemaps behind a toggle and OPFS-caches them via the PAL, decoded off the
  first-paint shell; plus an arbitrary SPICE-frame camera lock and dolly/crane verbs.
- Higher-fidelity analysis: an F10.7/Ap-driven Jacchia-1971 thermospheric density
  model (behind the `DensityModel` seam), an SQP optimizer for MCS targeting, and OD
  Bennett tropospheric refraction plus state-noise-compensation in the EKF.
- Web first-paint code-split: the analysis engines and workbench panels load on
  demand (the shell dropped from ~328 to ~293 kB gzip), and the size budget is now
  per-chunk (first-paint shell, lazy analysis, worker, WASM) instead of one sum.
- F3 foundation in `@bessel/spice`: an EvalSpec time-series interpreter, a
  cancellable-job protocol, a multi-worker SPICE pool, and `recgeo`/`et2lst`
  bindings; the `SpiceWindow` interval algebra and a shared geometry finder in
  `@bessel/timeline`.
- Interop: CCSDS OEM/OMM/CDM/AEM parse, OEM-to-SPK import, and CSV/CZML export.
- Decision records: ADR-0010 (analysis compute substrate), ADR-0011 (native-first
  analysis; GMAT deferred), and ADR-0012 (MONTE relationship: consume SPK/CCSDS,
  optional licensed ComputeProvider).
- Documentation: a getting-started guide, an analysis-tools reference, an
  architecture overview, a build-from-source guide, and a docs index.

### Notes

- Every analysis quantity is validated against an independent numeric reference
  (see REFERENCES.md and docs/STK_PARITY_SPEC.md).
- Earlier work (the Cosmographia parity closure) is recorded in
  docs/PARITY_MATRIX.md Section 15.

[Unreleased]: https://github.com/PaulMRamirez/bessel/commits/main
