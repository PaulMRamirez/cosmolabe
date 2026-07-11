// The impulsive-burn primitive: add a delta-v (rotated from its authored VNB/inertial
// frame) to the velocity, leaving position and epoch unchanged. Finite burns are reserved
// (NotImplementedError). Returns a fresh MissionState, never mutating the input, so the
// corrector can re-burn from the same state. (STK_PARITY_SPEC §4.3.)

import type { MissionState } from './state.ts';
import { pushPath } from './state.ts';
import type { ManeuverSegment } from './segments.ts';
import { dvToInertial } from './frames.ts';
import { NotImplementedError } from './errors.ts';

export function applyImpulsive(s: MissionState, seg: ManeuverSegment): MissionState {
  const path = [...s.segmentPath, seg.id];
  if (seg.mode !== 'Impulsive') throw new NotImplementedError(path, 'finite-burn maneuvers');
  if (seg.isp != null) throw new NotImplementedError(path, 'mass-depleting (Isp) maneuvers');
  const dvI = dvToInertial(seg.attitude, seg.dv, s.r, s.v);
  const burned: MissionState = {
    epoch: s.epoch,
    r: s.r,
    v: { x: s.v.x + dvI.x, y: s.v.y + dvI.y, z: s.v.z + dvI.z },
    mass: s.mass,
    centralBody: s.centralBody,
    segmentPath: s.segmentPath,
  };
  return pushPath(burned, seg.id);
}
