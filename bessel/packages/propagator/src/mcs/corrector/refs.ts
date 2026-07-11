// The bridge between a Target's string-keyed controls/goals and concrete reads, writes,
// and gradients. This is the ONLY module that interprets ControlParam/GoalType strings, so
// the corrector core stays string-free. A ControlBinding reads/writes one field of an
// immutable segment tree (write returns a fresh tree); a GoalBinding measures one scalar
// and, where closed-form, supplies dg/dx for the STM-analytic Jacobian. (STK_PARITY_SPEC §4.3.)

import type { Vec3 } from '@bessel/spice';
import type { ControlVar, Goal, GoalType, ManeuverSegment, Segment } from '../segments.ts';
import type { MissionState } from '../state.ts';
import { rv2coe } from '../elements.ts';
import { McsError } from '../errors.ts';

const vecOf = (s: MissionState): { r: Vec3; v: Vec3 } => ({ r: s.r, v: s.v });

export interface SeedAxis {
  readonly segment: string;
  readonly axis: 'x' | 'y' | 'z';
  readonly kind: 'dv' | 'r' | 'v';
  readonly attitude: 'VNB' | 'Inertial';
}

export interface ControlBinding {
  read(): number;
  write(children: readonly Segment[], value: number): readonly Segment[];
  readonly scale: number;
  readonly perturbation: number;
  readonly maxStep: number;
  readonly stmServed: boolean;
  readonly seedAxis?: SeedAxis;
  readonly segment: string;
}

/** Replace the segment with id `id` (searching nested children) via `patch`. */
function patchById(children: readonly Segment[], id: string, patch: (s: Segment) => Segment): readonly Segment[] {
  return children.map((s) => {
    if (s.id === id) return patch(s);
    if (s.kind === 'Sequence' || s.kind === 'Target') return { ...s, children: patchById(s.children, id, patch) };
    return s;
  });
}

function findById(children: readonly Segment[], id: string): Segment | undefined {
  for (const s of children) {
    if (s.id === id) return s;
    if (s.kind === 'Sequence' || s.kind === 'Target') {
      const f = findById(s.children, id);
      if (f) return f;
    }
  }
  return undefined;
}

export function bindControls(children: readonly Segment[], controls: readonly ControlVar[]): readonly ControlBinding[] {
  return controls.map((c) => {
    const seg = findById(children, c.segment);
    if (!seg) throw new McsError(`control references unknown segment "${c.segment}"`, []);
    const initial = c.initial ?? readParam(seg, c.param);
    const scale = c.scale ?? Math.max(Math.abs(initial), 1);
    const maxStep = c.maxStep ?? Infinity;
    const axis = c.param.endsWith('.x') ? 'x' : c.param.endsWith('.y') ? 'y' : 'z';
    let stmServed = false;
    let seedAxis: SeedAxis | undefined;
    if (c.param.startsWith('Maneuver.dv.')) {
      stmServed = true;
      seedAxis = { segment: c.segment, axis, kind: 'dv', attitude: (seg as ManeuverSegment).attitude };
    } else if (c.param.startsWith('InitialState.r.')) {
      stmServed = true;
      seedAxis = { segment: c.segment, axis, kind: 'r', attitude: 'Inertial' };
    } else if (c.param.startsWith('InitialState.v.')) {
      stmServed = true;
      seedAxis = { segment: c.segment, axis, kind: 'v', attitude: 'Inertial' };
    }
    return {
      segment: c.segment,
      scale,
      perturbation: c.perturbation,
      maxStep,
      stmServed,
      seedAxis,
      read: () => initial,
      write: (tree, value) => patchById(tree, c.segment, (s) => writeParam(s, c.param, value)),
    };
  });
}

function readParam(seg: Segment, param: ControlVar['param']): number {
  if (param.startsWith('Maneuver.dv.')) return (seg as ManeuverSegment).dv[axisOf(param)];
  if (param === 'Maneuver.duration') return seg.kind === 'Maneuver' ? seg.duration ?? 0 : 0;
  if (param === 'Maneuver.thrustN') return seg.kind === 'Maneuver' ? seg.thrustN ?? 0 : 0;
  if (param === 'Propagate.maxDuration') return seg.kind === 'Propagate' ? seg.maxDuration : 0;
  if (param === 'InitialState.epoch') return seg.kind === 'InitialState' ? seg.epoch : 0;
  if (seg.kind === 'InitialState' && seg.coord.type === 'Cartesian') {
    const which = param.includes('.r.') ? seg.coord.r : seg.coord.v;
    return which[axisOf(param)];
  }
  throw new McsError(`cannot read control param ${param} from a ${seg.kind} segment`, []);
}

function writeParam(seg: Segment, param: ControlVar['param'], value: number): Segment {
  if (param.startsWith('Maneuver.dv.') && seg.kind === 'Maneuver') {
    return { ...seg, dv: { ...seg.dv, [axisOf(param)]: value } };
  }
  if (param === 'Maneuver.duration' && seg.kind === 'Maneuver') return { ...seg, duration: value };
  if (param === 'Maneuver.thrustN' && seg.kind === 'Maneuver') return { ...seg, thrustN: value };
  if (param === 'Propagate.maxDuration' && seg.kind === 'Propagate') return { ...seg, maxDuration: value };
  if (param === 'InitialState.epoch' && seg.kind === 'InitialState') return { ...seg, epoch: value };
  if (seg.kind === 'InitialState' && seg.coord.type === 'Cartesian') {
    const a = axisOf(param);
    const coord = param.includes('.r.')
      ? { ...seg.coord, r: { ...seg.coord.r, [a]: value } }
      : { ...seg.coord, v: { ...seg.coord.v, [a]: value } };
    return { ...seg, coord };
  }
  throw new McsError(`cannot write control param ${param} to a ${seg.kind} segment`, []);
}

const axisOf = (param: string): 'x' | 'y' | 'z' => (param.endsWith('.x') ? 'x' : param.endsWith('.y') ? 'y' : 'z');

export interface GoalBinding {
  readonly evalAt: string;
  residual(s: MissionState, mu: number): number;
  gradWrtState(s: MissionState, mu: number): Float64Array | null;
  readonly tolerance: number;
  readonly weight: number;
  readonly type: GoalType;
  readonly desired: number;
}

/**
 * Goal types whose achieved value is an angle on the circle [0, 2pi): a raw achieved - desired
 * residual does not wrap, so a goal near 0/2pi (desired ~0.02, achieved ~6.27) yields a spurious
 * ~2pi residual and a false non-convergence. For these the residual is wrapped into (-pi, pi].
 * Inclination is NOT here: it lives in [0, pi] and never wraps.
 */
const PERIODIC_GOALS: ReadonlySet<GoalType> = new Set<GoalType>(['RAAN', 'ArgP']);

const TWO_PI = 2 * Math.PI;

/** Wrap an angular residual into (-pi, pi] so a wrap-around near 0/2pi is the short way round. */
function wrapResidual(delta: number): number {
  let d = delta % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export function bindGoals(goals: readonly Goal[]): readonly GoalBinding[] {
  return goals.map((g) => {
    if (g.type === 'TimeOfFlight') throw new McsError('TimeOfFlight goals are not supported in this phase', []);
    const periodic = PERIODIC_GOALS.has(g.type);
    return {
      evalAt: g.evalAt,
      type: g.type,
      tolerance: g.tolerance,
      weight: g.weight ?? 1,
      desired: g.desired,
      residual: (s, mu) => {
        const delta = achieved(g.type, s, mu, g.bodyRadius) - g.desired;
        return periodic ? wrapResidual(delta) : delta;
      },
      gradWrtState: (s) => gradOf(g.type, s),
    };
  });
}

function achieved(type: GoalType, s: MissionState, mu: number, bodyRadius?: number): number {
  const { r, v } = vecOf(s);
  const rmag = Math.hypot(r.x, r.y, r.z);
  switch (type) {
    case 'Radius': return rmag;
    case 'Altitude': return rmag - (bodyRadius ?? 0);
    case 'Position.x': return r.x;
    case 'Position.y': return r.y;
    case 'Position.z': return r.z;
    case 'Velocity.x': return v.x;
    case 'Velocity.y': return v.y;
    case 'Velocity.z': return v.z;
    case 'Epoch': return s.epoch;
    default: {
      const coe = rv2coe(mu, r, v);
      switch (type) {
        case 'RadiusOfApoapsis': return coe.raApo;
        case 'RadiusOfPeriapsis': return coe.raPeri;
        case 'SMA': return coe.sma;
        case 'Ecc': return coe.ecc;
        case 'Inc': return coe.inc;
        case 'RAAN': return coe.raan;
        case 'ArgP': return coe.argp;
        case 'FlightPathAngle': return coe.fpa;
        default: throw new McsError(`unsupported goal type ${type}`, []);
      }
    }
  }
}

/**
 * Floor below which the position magnitude is too small to form a stable radial unit vector. The
 * Radius/Altitude gradient is r/|r|; at |r| ~ 0 that divides to a NaN/Inf unit vector which would
 * silently PASS the analytic-vs-FD check (NaN compares true to nothing, so the column is accepted)
 * and then poison the STM columns. Return null below the floor so the corrector finite-differences
 * that column instead, the same fall-back the analytic path already uses for unsupported goals.
 */
const RMAG_GRAD_FLOOR = 1e-9;

/** Closed-form dg/dx (length 6), or null to force a finite-difference column. */
function gradOf(type: GoalType, s: MissionState): Float64Array | null {
  const { r, v } = vecOf(s);
  const rmag = Math.hypot(r.x, r.y, r.z);
  const unitR = [r.x / rmag, r.y / rmag, r.z / rmag];
  switch (type) {
    case 'Radius':
    case 'Altitude':
      if (rmag < RMAG_GRAD_FLOOR) return null; // degenerate radial direction: force finite difference
      return Float64Array.of(unitR[0]!, unitR[1]!, unitR[2]!, 0, 0, 0);
    case 'Position.x': return Float64Array.of(1, 0, 0, 0, 0, 0);
    case 'Position.y': return Float64Array.of(0, 1, 0, 0, 0, 0);
    case 'Position.z': return Float64Array.of(0, 0, 1, 0, 0, 0);
    case 'Velocity.x': return Float64Array.of(0, 0, 0, 1, 0, 0);
    case 'Velocity.y': return Float64Array.of(0, 0, 0, 0, 1, 0);
    case 'Velocity.z': return Float64Array.of(0, 0, 0, 0, 0, 1);
    case 'FlightPathAngle': return fpaGrad(r, v);
    default: return null; // element/time goals fall to finite difference
  }
}

/** Gradient of asin((r.v)/(|r||v|)) over the 6-state. */
function fpaGrad(r: Vec3, v: Vec3): Float64Array {
  const rm = Math.hypot(r.x, r.y, r.z);
  const vm = Math.hypot(v.x, v.y, v.z);
  const p = r.x * v.x + r.y * v.y + r.z * v.z;
  const sVal = p / (rm * vm);
  const denom = Math.sqrt(Math.max(1 - sVal * sVal, 1e-300));
  const dr = [
    v.x / (rm * vm) - (p * r.x) / (rm * rm * rm * vm),
    v.y / (rm * vm) - (p * r.y) / (rm * rm * rm * vm),
    v.z / (rm * vm) - (p * r.z) / (rm * rm * rm * vm),
  ];
  const dv = [
    r.x / (rm * vm) - (p * v.x) / (rm * vm * vm * vm),
    r.y / (rm * vm) - (p * v.y) / (rm * vm * vm * vm),
    r.z / (rm * vm) - (p * v.z) / (rm * vm * vm * vm),
  ];
  return Float64Array.of(dr[0]! / denom, dr[1]! / denom, dr[2]! / denom, dv[0]! / denom, dv[1]! / denom, dv[2]! / denom);
}
