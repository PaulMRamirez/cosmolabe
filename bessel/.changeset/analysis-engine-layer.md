---
"@bessel/spice": minor
"@bessel/timeline": minor
"@bessel/propagator": minor
"@bessel/access": minor
"@bessel/events": minor
"@bessel/rf": minor
"@bessel/coverage": minor
"@bessel/conjunction": minor
"@bessel/attitude": minor
"@bessel/sensors": minor
"@bessel/mission": minor
"@bessel/map-projection": minor
"@bessel/interop": minor
"@bessel/analysis": minor
"@bessel/terrain": minor
"@bessel/state": minor
"@bessel/ui": minor
"@bessel/web": minor
---

Add the mission-analysis engine layer and surface it in three viewer workbenches.

- Foundation (F3): an EvalSpec time-series interpreter, a cancellable-job
  protocol, and a multi-worker SPICE pool in `@bessel/spice`, plus `recgeo`/
  `et2lst` bindings and the `SpiceWindow` interval algebra in `@bessel/timeline`.
- Propagation: SGP4 with TLE/OMM ingest, two-body and J2/J4 mean-element theory,
  SPK Type-13 publish, and a native Cowell HPOP (adaptive DOPRI5 with a pluggable
  force model: point-mass, zonal J2..J4, third-body), validated against CSPICE
  prop2b and the analytic J2 secular rates (`@bessel/propagator`).
- Analysis engines: access and coverage (`@bessel/access`, `@bessel/coverage`),
  eclipse and lighting (`@bessel/events`), communications link budgets with
  ITU-R attenuation (`@bessel/rf`), conjunction TCA and 2D collision probability
  (`@bessel/conjunction`), attitude profiles and keep-out (`@bessel/attitude`),
  sensor footprints and swaths (`@bessel/sensors`), Lambert and impulsive
  maneuvers (`@bessel/mission`), map projections (`@bessel/map-projection`), and
  CCSDS OEM/OMM/CDM interop with CSV/CZML export (`@bessel/interop`).
- UI: the Analysis, Propagate, and Report workbenches (a unit-tagged provider
  registry driving cancellable evalSeries jobs, report tables, and CSV export),
  with charting primitives in `@bessel/ui`, wired end to end with e2e coverage.
