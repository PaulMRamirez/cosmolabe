# @bessel/od

Orbit determination: estimate a spacecraft's Cartesian state (and its uncertainty) from tracking measurements. It provides a Gauss-Newton batch least-squares estimator and a sequential extended Kalman filter (EKF), both seeded by the State Transition Matrix the Cowell propagator co-integrates through the variational equations. Measurement models for range, range-rate, and angles are analytic. Core layer.

## Public API

Estimators:

- `batchLeastSquares(initialGuess, measurements, options): BatchResult` iterates Gauss-Newton over an arc of measurements: propagate the current estimate to each measurement epoch (with the STM), map each measurement partial back to the solve epoch via `H_i = (dh/dx)_i * Phi(t_i, t0)`, accumulate and solve the normal equations, update, repeat. Returns the estimated state at `t0`, its covariance (the inverse information matrix), the post-fit residual RMS, and the iteration count. Pass an optional `consider` block (a count, an a-priori `Pcc`, and a per-measurement sensitivity `dh/dp`) to also get a `considerCovariance`: the consider-augmented covariance `Pc = Pxx + Sxc Pcc Sxc^T` (`Sxc = -Pxx Lambda_xc`), which inflates the estimate-only covariance to account for un-estimated-but-uncertain parameters (a drag coefficient, a measurement bias). The state estimate is unchanged; `Pc >= Pxx` always (positive-semidefinite inflation).
- `ExtendedKalmanFilter` is a running sequential filter: construct it with an initial state and covariance, then call `update(measurement)` for each observation in ascending epoch order. Each `update` does a time update (propagate the state, map the covariance through the STM, add optional process noise `Q`) then a Joseph-form measurement update, and returns the a-posteriori state, covariance, the normalized innovation RMS, and the NIS. Process noise can be a static 6x6 `processNoise` and/or state-noise compensation (SNC): pass `snc: { sigmaAccel }` (an isotropic scalar or a per-axis triple, the one-sigma white-noise acceleration spectral density) and the filter integrates the standard piecewise-constant-acceleration block `Q_rr = (dt^3/3) sigma^2`, `Q_rv = (dt^2/2) sigma^2`, `Q_vv = dt sigma^2` over each time-update span `dt`, which keeps the filter consistent on a maneuvering or mismodeled truth where a no-process-noise filter grows overconfident and diverges.

Measurement models (pure functions of geometry):

- `predict(measurement, state6): Prediction` returns the model value `h(x)` and the analytic Jacobian `dh/dx` (1x6 for range/range-rate, 2x6 for angles), from instantaneous geometry.
- `predictLightTime(measurement, arc, options?): LightTimePrediction` is the light-time-corrected counterpart: it solves the down-leg light-time equation `tau = |r_sat(t_rx - tau) - r_obs| / c` by fixed-point iteration, evaluates the observable on the RETARDED target state, and refers the partial back to the reception epoch through the arc STM with the `1/(1 - rangeRate/c)` light-time factor. `SPEED_OF_LIGHT_KM_S` is the constant used. This accounts for the photon travel time between observer and target, the standard reception (down-leg) aberration correction.
- `Measurement` is the tagged union `RangeMeasurement | RangeRateMeasurement | AnglesMeasurement`; angles support `radec` (topocentric right ascension/declination) and `azel` (azimuth/elevation in a supplied local East-North-Up frame). Every measurement carries the observer's inertial (ECI) position, the epoch, and a noise sigma.
- Tropospheric refraction: an `azel` measurement may set `refraction: true` (standard sea-level conditions) or `refraction: { pressureMbar, temperatureK }` so the predicted elevation is raised by the Bennett (1982) refraction angle `R(el) = (1/60) cot(el + 7.31/(el + 4.4))` (deg), the apparent-minus-geometric elevation a station actually reports: about 1.6 mrad at 10 degrees elevation, rising toward the horizon and vanishing at the zenith. Azimuth is unaffected (the bending is vertical), and the elevation partial picks up the `1 + dR/del` chain factor. `bennettRefraction(elRad, conditions?)` and `bennettRefractionSlope(elRad, conditions?)` (with `RefractionConditions`) expose the angle and its slope directly.

Support:

- `propagateArc(state6, t0, epochs, forceModel)` wraps `propagateCowellEx` with the STM channel, exposing `stateAt(et)` and `stmAt(et)` samplers over one shared dense solution.
- `linalg` exposes the tiny dense matrix kit (`matmul`, `transpose`, `symInverse` via Cholesky, `gaussSolve` via Gaussian elimination with partial pivoting, `isPositiveDefinite`) used by the estimators.

```ts
import { batchLeastSquares } from '@bessel/od';
import { createForceModel, pointMass, zonalHarmonics } from '@bessel/propagator';

const fm = createForceModel([pointMass(398600.4418), zonalHarmonics({ gm: 398600.4418, re: 6378.137 }, { j2: 1.08262668e-3 })]);
const result = batchLeastSquares({ x: guess6, epoch: t0 }, measurements, { forceModel: fm });
// result.state.x is the estimated [x,y,z,vx,vy,vz]; result.covariance is the 6x6.
```

## Dependency rule

Depends on: `@bessel/propagator` (the Cowell propagator and its STM channel, the force-model seam) and `@bessel/spice` (the `CartesianState` shape only). Part of the core layer: it imports no PAL implementation and no UI. Lower layers never import it.

## Algorithm and references

Both estimators linearize the measurement-to-state map about the current estimate and use the STM to refer partials taken at a measurement epoch back to the estimation epoch. Batch least squares is Gauss-Newton on the weighted normal equations `(sum H^T W H) dx = (sum H^T W y)`, with `W` the inverse measurement-noise covariance; the estimate covariance is the inverse information matrix `(H^T W H)^-1`. The EKF is the standard predictor/corrector recursion with the Joseph-stabilized covariance update for numerical positive-definiteness. The normal-matrix solve is a self-contained Gaussian elimination with partial pivoting; the symmetric inverse uses a Cholesky factor. See the project [REFERENCES.md](../../REFERENCES.md): Tapley, Schutz, and Born, *Statistical Orbit Determination* (chapters 4 and 5) for both estimators, and Vallado, *Fundamentals of Astrodynamics and Applications* (sections 4.4 and 10) for the measurement geometry and the batch/sequential framing.

## Tests

The primary oracle is self-consistency against a truth trajectory the test generates: a known LEO state is propagated under point-mass + J2, perfect (zero-noise) range, range-rate, and angle measurements are synthesized from a known observer, the initial guess is perturbed off truth, and `batchLeastSquares` is asserted to recover the truth state to position < 1e-3 km and velocity < 1e-6 km/s with a residual RMS near zero (`packages/od/src/batch-ls.test.ts`). A noisy case adds small Gaussian noise from a deterministic linear congruential generator and asserts the estimate is within a few sigma of truth and the covariance is positive definite. The EKF test (`packages/od/src/ekf.test.ts`) feeds a dense measurement stream and asserts the estimate converges toward truth, the covariance stays positive definite, and the per-step NIS stays bounded. `packages/od/src/measurements.test.ts` checks every analytic measurement partial against a central finite difference of `h(state)`, and `packages/od/src/linalg.test.ts` checks the matrix kit (notably that an inverse times its matrix is the identity).

## Status / limitations

The observer is treated as inertial (its velocity is taken as zero in the estimation frame), the standard ground-station-in-ECI convention for these tests; a rotating-station velocity term is not yet modeled in range-rate. Light-time is corrected via `predictLightTime`; tropospheric refraction is corrected for `azel` elevation via the opt-in Bennett model (the EKF/batch call the geometric `predict`, so refraction applies to measurements whose `refraction` flag is set). The EKF process noise supports a static `Q` and state-noise compensation (`snc`); the batch estimator has no process noise (Gauss-Newton). The estimators carry a fixed 6-state (position and velocity); solve-for parameters such as a drag coefficient or measurement biases (an augmented filter/consider analysis) are future work. The batch propagation integrates forward only, so the solve epoch must be at or before the earliest measurement.
