// Compile a Propagate segment's stop conditions into terminal EventSpecs the dense
// integrator scans. Each switching function reads only the flat state y[0..5] (position,
// velocity), so it is allocation-free in the inner loop. A duration backstop is always
// appended so a propagation can never run unbounded. (STK_PARITY_SPEC §4.3.)

import type { EventSpec } from '../events.ts';
import type { StopCondition } from './segments.ts';
import { trueAnomalyOf } from './elements.ts';

const TWO_PI = 2 * Math.PI;

export interface CompiledStops {
  readonly specs: readonly EventSpec[];
  /** Index of the always-appended duration backstop within `specs`. */
  readonly backstopIndex: number;
}

/** Wrap an angle difference into [-pi, pi) for a continuous true-anomaly switching function. */
function wrapPi(a: number): number {
  let x = a % TWO_PI;
  if (x >= Math.PI) x -= TWO_PI;
  if (x < -Math.PI) x += TWO_PI;
  return x;
}

const radius = (y: Float64Array): number => Math.hypot(y[0]!, y[1]!, y[2]!);
const rDotV = (y: Float64Array): number => y[0]! * y[3]! + y[1]! * y[4]! + y[2]! * y[5]!;

/**
 * Compile `stop` plus an always-on duration backstop into terminal EventSpecs. `epoch` and
 * `maxDuration` bound the arc; `mu`/`bodyRadius` parameterize the geometric conditions.
 */
export function compileStops(
  stop: readonly StopCondition[],
  epoch: number,
  maxDuration: number,
  mu: number,
  bodyRadius: number,
): CompiledStops {
  const specs: EventSpec[] = [];

  for (const s of stop) {
    switch (s.type) {
      case 'Duration':
        specs.push({ name: 'Duration', g: (t) => t - (epoch + s.value), direction: 1, terminal: true });
        break;
      case 'Epoch':
        specs.push({ name: 'Epoch', g: (t) => t - s.value, direction: 1, terminal: true });
        break;
      case 'Apoapsis':
        // r.v falls through zero (rising radius to falling) at apoapsis.
        specs.push({ name: 'Apoapsis', g: (_t, y) => rDotV(y), direction: -1, terminal: true });
        break;
      case 'Periapsis':
        specs.push({ name: 'Periapsis', g: (_t, y) => rDotV(y), direction: 1, terminal: true });
        break;
      case 'Altitude': {
        const target = bodyRadius + s.value;
        specs.push({
          name: 'Altitude',
          g: (_t, y) => radius(y) - target,
          direction: s.crossing === 'rising' ? 1 : -1,
          terminal: true,
        });
        break;
      }
      case 'Radius':
        specs.push({
          name: 'Radius',
          g: (_t, y) => radius(y) - s.value,
          direction: s.crossing === 'rising' ? 1 : s.crossing === 'falling' ? -1 : 0,
          terminal: true,
        });
        break;
      case 'TrueAnomaly':
        specs.push({
          name: 'TrueAnomaly',
          g: (_t, y) => wrapPi(trueAnomalyOf(mu, { x: y[0]!, y: y[1]!, z: y[2]! }, { x: y[3]!, y: y[4]!, z: y[5]! }) - s.value),
          direction: 1,
          terminal: true,
        });
        break;
    }
  }

  const backstopIndex = specs.length;
  specs.push({ name: 'backstop', g: (t) => t - (epoch + maxDuration), direction: 1, terminal: true });
  return { specs, backstopIndex };
}
