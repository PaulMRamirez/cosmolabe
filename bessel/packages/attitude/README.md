# @bessel/attitude

Spacecraft pointing laws and slew kinematics: two-vector attitude profiles
(nadir, Sun-pointing), eigen-axis slews with a trapezoidal rate profile, and
pointing keep-out (exclusion) analysis. Core layer (STK_PARITY_SPEC §4.6).

## Public API

Quaternion kinematics (pure):

- `Quaternion` is a SPICE-convention `[w, x, y, z]` (scalar first).
- `slerp(from, to, t)`: shortest-path spherical linear interpolation.
- `eigenAxisSlew(from, to, maxRate, maxAccel): Slew`: shortest-arc eigen-axis
  slew honoring a max angular rate and acceleration. The `Slew` exposes `angle`,
  `duration`, and `at(t)` (orientation over `[0, duration]`).

Two-vector pointing (SPICE-backed, return the J2000 -> body `Mat3` at `et`):

- `nadirAttitude(spice, observer, body, et, axes?)`: primary axis to nadir,
  secondary toward velocity.
- `sunPointingAttitude(spice, observer, secondaryTarget, et, axes?)`: primary
  axis to the Sun, secondary toward a reference body. `TwoVectorAxes` picks the
  body `primaryAxis`/`secondaryAxis` (1=X, 2=Y, 3=Z; defaults 3 and 1).

Keep-out (exclusion) geometry and windows:

- `angularSeparationRad(a, b)`, `withinKeepOut(boresight, bodyDir, halfAngleRad)`.
- `keepOutWindow(spice, KeepOutRequest)`: intervals where the boresight stays
  outside an exclusion cone about a bright body, refined by bisection.

Attitude history read/write and the pxform-style query (CK Type 3 analog):

- `attitudeHistory(records): AttitudeHistory`: build a queryable history from
  tabulated `AttitudeRecord`s (`et`, scalar-first `quaternion`, strictly ascending).
- `AttitudeHistory.quaternionAt(et)`: orientation quaternion at any epoch in the
  span by shortest-path SLERP, exact at sample epochs.
- `AttitudeHistory.pxformAt(et): Mat3`: the orientation as a rotation matrix (the
  `pxform`-style body-orientation query).
- `quaternionToMatrix(q): Mat3`: scalar-first quaternion to a row-major matrix,
  matching CSPICE `q2m`. Loud `AttitudeHistoryError` on a bad or out-of-span query.

The portable read/write path is the CCSDS AEM round-trip in `@bessel/interop`
(`parseAem` / `writeAem`): write the profile as a tabulated quaternion segment, read
it back, then sample it here. A native CK *binary* write/read needs CSPICE-WASM
exports (`ckopn`/`ckw03`/`ckcls`, `ckgp`/`ckgpav`/`sce2c`) that are not yet bound, so
CK-binary IO is deferred; this sampler is the CK-equivalent query meanwhile and gains
a native CK backend behind the same interface once those symbols are exported.

```ts
const hist = attitudeHistory([
  { et: 0, quaternion: [1, 0, 0, 0] },
  { et: 60, quaternion: [Math.SQRT1_2, Math.SQRT1_2, 0, 0] },
]);
const m = hist.pxformAt(30); // SLERP-interpolated body orientation
```

```ts
const slew = eigenAxisSlew(from, to, 0.02, 0.005);
const q = slew.at(slew.duration / 2);
const m = await nadirAttitude(spice, '-82', 'SATURN', et, { primaryAxis: 3, secondaryAxis: 1 });
```

## Dependency rule

Depends on: `@bessel/spice` (geometry, `twovec`, `Mat3`/`Vec3`) and
`@bessel/timeline` (the constraint-window finder for keep-out). Part of the core
layer; it imports no PAL implementation and no UI.

## Tests

Tests live in `packages/attitude/src/attitude.test.ts`,
`packages/attitude/src/keep-out.test.ts`, and `packages/attitude/src/ck.test.ts`.
The slew/slerp tests assert pure kinematics (exact spanned angle, endpoint match,
monotonic progress, triangular vs trapezoidal profile). `nadirAttitude` is validated
against the de440 / Cassini SOI fixtures: the body +Z row of the returned matrix is
checked against the SPICE-computed nadir direction. The attitude-history tests pin
`quaternionToMatrix` against CSPICE `q2m` (independent oracle), recover each source
quaternion exactly at its sample epoch, interpolate a midpoint to the hand-computed
half-angle rotation, and fail loudly outside the span; the AEM round-trip oracle
lives in `@bessel/interop` (`aem-write.test.ts`).

## Algorithm and references

Two-vector pointing reuses CSPICE `twovec` for the orthonormalization (NAIF SPICE
toolkit; see REFERENCES.md, "SPICE and NAIF"). Slews are standard quaternion
eigen-axis kinematics with a trapezoidal (or triangular) angular-rate profile,
interpolated by shortest-path SLERP. Keep-out uses robust `atan2` angular
separation with sampling plus bisection on the constraint function.

## Status / limitations

Pointing laws cover nadir, Sun-pointing, and the eigen-axis slew; there is no
spin or general target-tracking profile yet. Slews are kinematic only (no torque
or actuator model), and keep-out windows are found by sampling plus bisection, so
the step must be fine enough to resolve short violations.
