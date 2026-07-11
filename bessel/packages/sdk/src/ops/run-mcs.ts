// The runMcs op: validate and execute a mission control sequence through the propagator's
// MCS executor, with a SPICE-free dynamics environment (the job may override the per-body
// gravity table). The first real consumer of the MCS executor. (STK_PARITY_SPEC, SDK.)

import { createMissionEnv, runMission, validateMcs, type BodyDynamics } from '@bessel/propagator';
import { McsValidationError } from '../errors.ts';
import type { RunMcsOp } from '../job/types.ts';
import type { OpContext } from '../runner/context.ts';
import type { OpResult } from '../runner/results.ts';

export async function runRunMcs(op: RunMcsOp, ctx: OpContext): Promise<OpResult> {
  try {
    validateMcs(op.mcs);
  } catch (cause) {
    throw new McsValidationError(`MCS "${op.id}" failed validation: ${(cause as Error).message}`, cause);
  }
  const env = op.bodies
    ? createMissionEnv(new Map<number, BodyDynamics>(Object.entries(op.bodies).map(([k, d]) => [Number(k), d])))
    : ctx.env;
  const run = await runMission(op.mcs, env);
  return { kind: 'mcs', run, center: op.center ?? ctx.defaults.center, frame: ctx.defaults.frame };
}
