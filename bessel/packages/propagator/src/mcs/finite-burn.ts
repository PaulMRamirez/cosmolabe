// The finite (continuous-thrust) burn arc. A finite burn is a propagated arc, not an
// instantaneous velocity jump: the spacecraft coasts under the central-body force model
// with a constant-thrust term added, while its mass depletes per the rocket equation
// dm/dt = -T / (Isp * g0). We integrate a 7-state y = [r, v, m]: the position/velocity
// obey [v, a_gravity + a_thrust] and the mass obeys the constant mass-flow law, so mass
// is co-integrated (not quasi-static) and a_thrust = (T / m(t)) * dirHat tracks the true
// instantaneous mass throughout the arc. The thrust direction is resolved to a single
// inertial unit vector at the burn start (VNB frozen at ignition, or inertial as given).
// Post-burn state and depleted mass flow into the next segment. (STK_PARITY_SPEC §4.3.)

import type { ForceModel } from '../force/types.ts';
import { createForceModel } from '../force/model.ts';
import { constantThrust } from '../force/thrust.ts';
import { integrate, type IntegratorOptions, type Rhs } from '../integrator.ts';
import type { ManeuverSegment } from './segments.ts';
import type { MissionState } from './state.ts';
import { pushPath } from './state.ts';
import { dvToInertial } from './frames.ts';
import { McsError, PropagationDivergedError } from './errors.ts';

/** Standard gravity used for the Isp -> exhaust-velocity conversion (km/s^2). */
export const G0_KM_S2 = 9.80665e-3;
/** Newtons to (kg km/s^2): 1 N = 1e-3 kg km/s^2. */
const N_TO_KG_KM_S2 = 1e-3;

export interface FiniteBurnResult {
  readonly out: MissionState;
  /** Per-step sampled states along the burn arc (for publishing), oldest first. */
  readonly samples: readonly { readonly et: number; readonly r: { x: number; y: number; z: number }; readonly v: { x: number; y: number; z: number } }[];
}

/** The fixed inertial thrust unit vector for the arc: the burn direction frozen at ignition. */
function thrustDir(seg: ManeuverSegment, s: MissionState): { x: number; y: number; z: number } {
  const d = dvToInertial(seg.attitude, seg.dv, s.r, s.v);
  const mag = Math.hypot(d.x, d.y, d.z);
  if (mag < 1e-300) {
    // A zero authored vector has no direction; default to the prograde (VNB +V) axis.
    const fwd = dvToInertial(seg.attitude, { x: 1, y: 0, z: 0 }, s.r, s.v);
    const fm = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
    return { x: fwd.x / fm, y: fwd.y / fm, z: fwd.z / fm };
  }
  return { x: d.x / mag, y: d.y / mag, z: d.z / mag };
}

/**
 * Integrate a finite burn over `seg.duration` seconds starting from `s`, under the
 * central-body `baseModel` (gravity etc.) plus a constant-thrust term. Mass depletes per
 * the rocket equation; the post-burn state and mass are returned. The propagated arc is
 * sampled at `sampleCount` points (>= 2) for publishing.
 */
export function runFiniteBurn(
  seg: ManeuverSegment,
  s: MissionState,
  baseModel: ForceModel,
  tol: IntegratorOptions | undefined,
  sampleCount: number,
): FiniteBurnResult {
  const path = [...s.segmentPath, seg.id];
  const thrustN = seg.thrustN;
  const isp = seg.isp;
  const duration = seg.duration;
  if (thrustN == null || !(thrustN >= 0)) throw new McsError(`finite burn "${seg.id}" needs a non-negative thrustN`, path);
  if (isp == null || !(isp > 0)) throw new McsError(`finite burn "${seg.id}" needs a positive isp`, path);
  if (duration == null || !(duration > 0)) throw new McsError(`finite burn "${seg.id}" needs a positive duration`, path);

  const dir = thrustDir(seg, s);
  // dm/dt = -T / (Isp * g0); with T in N -> kg km/s^2 and g0 in km/s^2, mdot is kg/s.
  const mdot = -(thrustN * N_TO_KG_KM_S2) / (isp * G0_KM_S2);

  // Mass is the 7th integrated component; the thrust term reads it back each evaluation.
  let massCell = s.mass;
  const thrustTerm = constantThrust({ thrustN, dirHat: [dir.x, dir.y, dir.z], massNow: () => massCell });
  const model = createForceModel([...baseModel.terms, thrustTerm]);

  const rhs: Rhs = (t, y, dy) => {
    massCell = y[6]!;
    const a = model.acceleration({ et: t, r: [y[0]!, y[1]!, y[2]!], v: [y[3]!, y[4]!, y[5]!] });
    dy[0] = y[3]!;
    dy[1] = y[4]!;
    dy[2] = y[5]!;
    dy[3] = a[0];
    dy[4] = a[1];
    dy[5] = a[2];
    dy[6] = mdot; // constant mass flow over the arc
  };

  const t0 = s.epoch;
  const tEnd = s.epoch + duration;
  const n = Math.max(2, sampleCount);
  const grid = Float64Array.from({ length: n }, (_, k) => t0 + (duration * k) / (n - 1));
  const y0 = Float64Array.of(s.r.x, s.r.y, s.r.z, s.v.x, s.v.y, s.v.z, s.mass);

  const states = integrate(rhs, y0, t0, grid, tol);

  const samples = states.map((y, k) => ({
    et: grid[k]!,
    r: { x: y[0]!, y: y[1]!, z: y[2]! },
    v: { x: y[3]!, y: y[4]!, z: y[5]! },
  }));

  const last = states[states.length - 1]!;
  if (![last[0]!, last[1]!, last[2]!, last[3]!, last[4]!, last[5]!].every(Number.isFinite)) {
    throw new PropagationDivergedError(path, 'non-finite state at the end of the finite burn');
  }
  const massEnd = last[6]!;
  if (!(massEnd > 0)) throw new McsError(`finite burn "${seg.id}" depleted all propellant (mass <= 0)`, path);

  const burned: MissionState = {
    epoch: tEnd,
    r: { x: last[0]!, y: last[1]!, z: last[2]! },
    v: { x: last[3]!, y: last[4]!, z: last[5]! },
    mass: massEnd,
    centralBody: s.centralBody,
    segmentPath: s.segmentPath,
  };
  return { out: pushPath(burned, seg.id), samples };
}
