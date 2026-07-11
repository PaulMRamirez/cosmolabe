// Up-front structural validation of an MCS so the executor never has to police shape mid
// run. Checks: unique segment ids; every Target control points at a segment of the kind
// its parameter implies and resolves within the Target's own children; every goal's
// evalAt resolves; a Target has at least one control and is not under-determined without
// weights; Altitude goals carry a body radius. Fails loudly with the specific typed error.
// (STK_PARITY_SPEC §4.3.)

import type { ControlParam, Goal, Mcs, Segment, TargetSegment } from './segments.ts';
import { McsError, MissingControlsOrGoalsError } from './errors.ts';

const KIND_OF_PARAM: Record<ControlParam, Segment['kind']> = {
  'Maneuver.dv.x': 'Maneuver',
  'Maneuver.dv.y': 'Maneuver',
  'Maneuver.dv.z': 'Maneuver',
  'Maneuver.duration': 'Maneuver',
  'Maneuver.thrustN': 'Maneuver',
  'Propagate.maxDuration': 'Propagate',
  'InitialState.epoch': 'InitialState',
  'InitialState.r.x': 'InitialState',
  'InitialState.r.y': 'InitialState',
  'InitialState.r.z': 'InitialState',
  'InitialState.v.x': 'InitialState',
  'InitialState.v.y': 'InitialState',
  'InitialState.v.z': 'InitialState',
};

/** Collect every segment in pre-order, threading the path for located errors. */
function walk(seg: Segment, path: readonly string[], visit: (s: Segment, p: readonly string[]) => void): void {
  const here = [...path, seg.id];
  visit(seg, here);
  if (seg.kind === 'Sequence' || seg.kind === 'Target') {
    for (const child of seg.children) walk(child, here, visit);
  }
}

/** Index a segment subtree by id (for resolving control/goal references). */
function indexById(segments: readonly Segment[]): Map<string, Segment> {
  const map = new Map<string, Segment>();
  const add = (s: Segment): void => {
    map.set(s.id, s);
    if (s.kind === 'Sequence' || s.kind === 'Target') for (const c of s.children) add(c);
  };
  for (const s of segments) add(s);
  return map;
}

function validateTarget(tgt: TargetSegment, path: readonly string[]): void {
  const local = indexById(tgt.children);
  if (tgt.controls.length === 0) throw new MissingControlsOrGoalsError(path, 'a Target needs at least one control');
  if (tgt.goals.length === 0) throw new MissingControlsOrGoalsError(path, 'a Target needs at least one goal');

  for (const c of tgt.controls) {
    const target = local.get(c.segment);
    if (!target) throw new McsError(`control references unknown segment "${c.segment}"`, path);
    const expected = KIND_OF_PARAM[c.param];
    if (target.kind !== expected) {
      throw new McsError(`control param ${c.param} requires a ${expected} segment, but "${c.segment}" is a ${target.kind}`, path);
    }
  }

  for (const g of tgt.goals) {
    if (g.evalAt !== 'End' && !local.get(g.evalAt)) {
      throw new McsError(`goal evalAt references unknown segment "${g.evalAt}"`, path);
    }
    if (g.type === 'Altitude' && g.bodyRadius == null) {
      throw new McsError('an Altitude goal requires bodyRadius', path);
    }
  }

  // Over-determined (more goals than controls) is allowed only if every goal is weighted
  // (a weighted least-squares solve); otherwise the system is ambiguous.
  if (tgt.goals.length > tgt.controls.length && tgt.goals.some((g: Goal) => g.weight == null)) {
    throw new MissingControlsOrGoalsError(path, `${tgt.goals.length} goals > ${tgt.controls.length} controls without weights`);
  }
}

export function validateMcs(mcs: Mcs): void {
  const seen = new Set<string>();
  walk(mcs.root, [], (seg, path) => {
    if (seen.has(seg.id)) throw new McsError(`duplicate segment id "${seg.id}"`, path);
    seen.add(seg.id);
    if (seg.kind === 'Target') validateTarget(seg, path);
  });

  // Exactly one InitialState, and it must be the first executable segment of the root.
  const initials: string[] = [];
  walk(mcs.root, [], (seg) => {
    if (seg.kind === 'InitialState') initials.push(seg.id);
  });
  if (initials.length !== 1) {
    throw new McsError(`an MCS must contain exactly one InitialState (found ${initials.length})`, [mcs.root.id]);
  }
  if (mcs.root.children[0]?.kind !== 'InitialState') {
    throw new McsError('the first segment of the root sequence must be the InitialState', [mcs.root.id]);
  }
}
