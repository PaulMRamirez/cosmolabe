// Lambert's problem: given two position vectors and a transfer time, find the
// connecting two-body velocities. Universal-variable formulation (Bate-Mueller-
// White / Vallado), single revolution, with bisection on psi. Pure. (STK §4.2.)

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const mag = (a: Vec3): number => Math.sqrt(dot(a, a));
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Stumpff functions c2(psi), c3(psi). */
function stumpff(psi: number): { c2: number; c3: number } {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return { c2: (1 - Math.cos(s)) / psi, c3: (s - Math.sin(s)) / Math.sqrt(psi ** 3) };
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return { c2: (1 - Math.cosh(s)) / psi, c3: (Math.sinh(s) - s) / Math.sqrt((-psi) ** 3) };
  }
  return { c2: 0.5, c3: 1 / 6 };
}

export interface LambertSolution {
  readonly v1: Vec3;
  readonly v2: Vec3;
}

/**
 * Solve Lambert's problem between r1 and r2 with time of flight `tof` (s) about a
 * central body of gravitational parameter `mu`. `prograde` selects the transfer
 * direction. Throws if the geometry is degenerate or no solution converges.
 *
 * The transfer direction (short way vs long way) is decided by the sign of the
 * out-of-plane component of r1 x r2. Keying that off world +Z (the old behavior) is wrong
 * for any non-equatorial geometry: a polar transfer has (r1 x r2).z == 0, collapsing both
 * prograde and retrograde to the long way. Supply `orbitNormal` (the desired angular-momentum
 * direction, e.g. the transfer plane's normal) so the direction is taken against the real
 * orbit plane; when omitted the reference is world +Z, valid only for an equatorial transfer.
 */
export function lambert(
  r1: Vec3,
  r2: Vec3,
  tof: number,
  mu: number,
  prograde = true,
  orbitNormal?: Vec3,
): LambertSolution {
  const r1m = mag(r1);
  const r2m = mag(r2);
  const cosdnu = dot(r1, r2) / (r1m * r2m);
  // Out-of-plane component of r1 x r2, projected onto the chosen reference normal. Against the
  // true orbit normal a prograde transfer has a positive projection (the swept angle is in the
  // +normal sense), a retrograde one negative; this stays well-defined for polar geometry where
  // the world-Z component vanishes.
  const c = cross(r1, r2);
  const ref = orbitNormal ?? { x: 0, y: 0, z: 1 };
  const proj = dot(c, ref);
  // Transfer-angle sign: prograde transfers sweep in the +normal sense (positive projection).
  const tm = prograde ? (proj >= 0 ? 1 : -1) : proj < 0 ? 1 : -1;
  const A = tm * Math.sqrt(r1m * r2m * (1 + cosdnu));
  if (Math.abs(A) < 1e-9) throw new Error('lambert: degenerate transfer (A ~ 0)');

  let psi = 0;
  let psiUp = 4 * Math.PI ** 2;
  let psiLow = -4 * Math.PI;
  let { c2, c3 } = stumpff(psi);
  let y = 0;
  let converged = false;
  for (let iter = 0; iter < 200; iter++) {
    y = r1m + r2m + (A * (psi * c3 - 1)) / Math.sqrt(c2);
    if (A > 0 && y < 0) {
      // Raise the lower bound until y is non-negative.
      psiLow += 0.1;
      psi = (psiUp + psiLow) / 2;
      ({ c2, c3 } = stumpff(psi));
      continue;
    }
    const chi = Math.sqrt(y / c2);
    const dt = (chi ** 3 * c3 + A * Math.sqrt(y)) / Math.sqrt(mu);
    if (Math.abs(dt - tof) < 1e-6) {
      converged = true;
      break;
    }
    if (dt <= tof) psiLow = psi;
    else psiUp = psi;
    psi = (psiUp + psiLow) / 2;
    ({ c2, c3 } = stumpff(psi));
  }
  if (!converged) throw new Error('lambert: failed to converge');

  const f = 1 - y / r1m;
  const g = A * Math.sqrt(y / mu);
  const gdot = 1 - y / r2m;
  return {
    v1: scale(sub(r2, scale(r1, f)), 1 / g),
    v2: scale(sub(scale(r2, gdot), r1), 1 / g),
  };
}
