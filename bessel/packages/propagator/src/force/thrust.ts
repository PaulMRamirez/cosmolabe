// A constant-thrust force term for finite (continuous-thrust) burns: a = (T / m) * dirHat,
// where the thrust magnitude T (N) and the spacecraft mass m (kg) are converted to a
// km/s^2 acceleration. The thrust direction is a fixed inertial unit vector for the arc
// (the maneuver frame is resolved to inertial once, at the burn start, in the executor).
// Mass is supplied by a getter so the arc integrator can deplete it as the burn proceeds.
// (STK_PARITY_SPEC §4.3.)

import type { ForceContext, ForceTerm, Vector3 } from './types.ts';

/** Newtons to (kg km/s^2): 1 N = 1 kg m/s^2 = 1e-3 kg km/s^2. */
const N_TO_KG_KM_S2 = 1e-3;

export interface ConstantThrustOptions {
  /** Thrust magnitude (N). */
  readonly thrustN: number;
  /** Fixed inertial unit direction of the thrust over the arc. */
  readonly dirHat: Vector3;
  /** Current spacecraft mass (kg); read each evaluation so the arc can deplete it. */
  massNow(): number;
}

/**
 * a_thrust = (T / m) * dirHat in km/s^2. With T in N and m in kg, T/m is m/s^2, scaled
 * by 1e-3 to km/s^2. The term has no closed-form state partials (it is mass- and
 * direction-driven, not position-driven), so the STM channel central-differences it; in
 * practice finite-burn controls take the finite-difference Jacobian path, so this term is
 * never asked for analytic partials during targeting.
 */
export function constantThrust(opts: ConstantThrustOptions): ForceTerm {
  const { thrustN, dirHat, massNow } = opts;
  const tConv = thrustN * N_TO_KG_KM_S2;
  return {
    name: 'constantThrust',
    acceleration(_ctx: ForceContext): Vector3 {
      const m = massNow();
      if (!(m > 0)) return [0, 0, 0];
      const k = tConv / m;
      return [k * dirHat[0], k * dirHat[1], k * dirHat[2]];
    },
  };
}
