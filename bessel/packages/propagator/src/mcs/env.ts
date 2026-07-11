// The dynamics injection seam. The executor is SPICE-free and synchronous: the host
// supplies, per central body, the gravitational parameter, the body radius (for altitude
// stops/goals), and optionally a full n-body ForceModel. Two-body models are memoized so
// a Target's many corrector re-runs share one force model. (STK_PARITY_SPEC §4.3.)

import type { ForceModel } from '../force/types.ts';
import type { IntegratorOptions } from '../integrator.ts';
import { pointMass } from '../force/point-mass.ts';
import { createForceModel } from '../force/model.ts';
import { McsError } from './errors.ts';

export interface BodyDynamics {
  /** Gravitational parameter (km^3/s^2). */
  readonly gm: number;
  /** Mean/equatorial radius (km), for Altitude stops and goals. */
  readonly bodyRadius: number;
  /** Optional injected n-body force model for 'PointMassNBody' propagation. */
  readonly nBodyModel?: ForceModel;
}

export interface MissionEnv {
  /** Dynamics for a central body; throws (loud) if the host did not supply it. */
  dynamicsFor(centralBody: number): BodyDynamics;
  /** Memoized two-body (point-mass) force model for a central body. */
  twoBodyModel(centralBody: number): ForceModel;
  readonly integratorOptions?: IntegratorOptions;
}

export function createMissionEnv(table: ReadonlyMap<number, BodyDynamics>, opts?: IntegratorOptions): MissionEnv {
  const twoBodyCache = new Map<number, ForceModel>();
  return {
    integratorOptions: opts,
    dynamicsFor(centralBody: number): BodyDynamics {
      const d = table.get(centralBody);
      if (!d) throw new McsError(`no dynamics registered for central body ${centralBody}`, []);
      return d;
    },
    twoBodyModel(centralBody: number): ForceModel {
      const cached = twoBodyCache.get(centralBody);
      if (cached) return cached;
      const d = this.dynamicsFor(centralBody);
      const model = createForceModel([pointMass(d.gm)]);
      twoBodyCache.set(centralBody, model);
      return model;
    },
  };
}
