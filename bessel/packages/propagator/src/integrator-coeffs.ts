// Dormand-Prince 5(4) Butcher tableau (the canonical DOPRI5 / ode45 / SciPy RK45
// pair). Source: Hairer, Norsett & Wanner, "Solving Ordinary Differential Equations
// I", 2nd ed., Table 5.2. Public-domain numerical constants, not a kernel. The
// 5th-order solution weights B advance the state; the error weights E = B - Bhat give
// the embedded 4th-order error estimate. (STK_PARITY_SPEC §4.2.)

/** Stage time fractions c_i (c1 = 0 implied). */
export const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1] as const;

/** Lower-triangular stage coefficients a_ij (row i uses entries [0..i-1]). */
export const A: readonly (readonly number[])[] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];

// 5th-order solution weights (identical to the last A row; the pair is FSAL-capable,
// though the integrator recomputes stage 1 each step rather than exploiting FSAL).
export const B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0] as const;

/** Error weights E = B - Bhat (5th minus embedded 4th), for the step error estimate. */
export const E = [
  71 / 57600,
  0,
  -71 / 16695,
  71 / 1920,
  -17253 / 339200,
  22 / 525,
  -1 / 40,
] as const;

/** Number of stages. */
export const STAGES = 7;

/**
 * True iff the last stage is the step endpoint (C[last] === 1 and A[last] === B): the
 * FSAL position that lets the cubic-Hermite dense extension reuse k[last] as the
 * endpoint derivative f_new with no extra rhs call. The dense builder asserts this so
 * a future tableau swap fails loudly rather than producing a wrong interpolant.
 */
export const LAST_STAGE_IS_ENDPOINT = C[STAGES - 1] === 1;
