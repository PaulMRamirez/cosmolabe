// The MCS interpreter: a recursive dispatch that threads an immutable MissionState through
// the segment tree, reusing propagateCowellEx for coasts (with its event-driven stop
// conditions) and applyImpulsive for burns. A Target segment hands its child branch to the
// differential corrector, then replays the converged branch to publish its samples. The
// executor is SPICE-free and synchronous; runMission is the thin async public entry.
// (STK_PARITY_SPEC §4.3.)

import type { MissionEnv } from './env.ts';
import type { Mcs, PropagateSegment, Segment, TargetSegment } from './segments.ts';
import { DEFAULT_DC_SETTINGS } from './segments.ts';
import type { MissionState, SegmentResult, SegmentStatus, StateSample } from './state.ts';
import { sampleOf, toCartesian, withY6, pushPath } from './state.ts';
import { coe2rv } from './elements.ts';
import { applyImpulsive } from './maneuver.ts';
import { runFiniteBurn } from './finite-burn.ts';
import { compileStops } from './stop.ts';
import { propagateCowellEx } from '../cowell.ts';
import {
  MissingInitialStateError,
  NotImplementedError,
  PropagationDivergedError,
} from './errors.ts';
import { bindControls, bindGoals } from './corrector/refs.ts';
import { runDifferentialCorrector, runTargetOptimizer, type DcReport } from './corrector/solve.ts';
import type { OptimizerReport } from './corrector/optimize.ts';

export interface RunOpts {
  /** Co-integrate the STM on Propagate segments (used by the corrector's Jacobian). */
  readonly stm?: boolean;
}

export interface McsRun {
  readonly final: MissionState;
  readonly samples: readonly StateSample[];
  readonly targetReports: readonly DcReport[];
  /** Optimizer reports from any OPTIMIZER-mode Targets in the sequence. */
  readonly optimizerReports: readonly OptimizerReport[];
}

const finite = (s: MissionState): boolean =>
  [s.r.x, s.r.y, s.r.z, s.v.x, s.v.y, s.v.z].every(Number.isFinite);

/** Drop a sample whose epoch duplicates the previous tail (segment boundaries coincide). */
function appendSamples(acc: StateSample[], next: readonly StateSample[]): void {
  for (const s of next) {
    const tail = acc[acc.length - 1];
    if (tail && Math.abs(tail.et - s.et) < 1e-9) continue;
    acc.push(s);
  }
}

function runPropagate(seg: PropagateSegment, input: MissionState, env: MissionEnv, opts: RunOpts): SegmentResult {
  const path = [...input.segmentPath, seg.id];
  const dyn = env.dynamicsFor(input.centralBody);
  const model =
    seg.model === 'TwoBody'
      ? env.twoBodyModel(input.centralBody)
      : dyn.nBodyModel ?? (() => { throw new NotImplementedError(path, "model 'PointMassNBody' without an injected n-body model"); })();

  const step = seg.sampleStep ?? seg.maxDuration / 64;
  const count = Math.max(2, Math.ceil(seg.maxDuration / step) + 1);
  const grid = Float64Array.from({ length: count }, (_, k) => input.epoch + Math.min(k * step, seg.maxDuration));
  const { specs } = compileStops(seg.stop, input.epoch, seg.maxDuration, dyn.gm, dyn.bodyRadius);

  const res = propagateCowellEx({
    state: toCartesian(input),
    epoch: input.epoch,
    etGrid: grid,
    forceModel: model,
    frame: 'J2000',
    tolerances: seg.tolerances ?? env.integratorOptions,
    events: specs,
    stm: opts.stm,
    fdFallback: false,
  });

  const hit = res.events[res.events.length - 1];
  const out = hit ? withY6(pushPath(input, seg.id), hit.t, hit.y) : withY6(pushPath(input, seg.id), res.tEnd, lastRow(res.table));
  if (!finite(out)) throw new PropagationDivergedError(path, 'non-finite state at the stop epoch');
  const status: SegmentStatus = hit
    ? hit.name === 'backstop'
      ? { kind: 'backstop' }
      : { kind: 'stopped', by: hit.name }
    : { kind: 'backstop' };

  const samples: StateSample[] = [];
  for (let k = 0; k < res.table.et.length; k++) {
    samples.push({
      et: res.table.et[k]!,
      state: {
        position: { x: res.table.x[k]!, y: res.table.y[k]!, z: res.table.z[k]! },
        velocity: { x: res.table.vx[k]!, y: res.table.vy[k]!, z: res.table.vz[k]! },
      },
    });
  }
  appendSamples(samples, [sampleOf(out)]); // ensure the exact stop state ends the arc

  return { out, samples, status, halt: false, stmAt: res.stmAt, stmEpoch: input.epoch };
}

function lastRow(table: { et: Float64Array; x: Float64Array; y: Float64Array; z: Float64Array; vx: Float64Array; vy: Float64Array; vz: Float64Array }): Float64Array {
  const k = table.et.length - 1;
  return Float64Array.of(table.x[k]!, table.y[k]!, table.z[k]!, table.vx[k]!, table.vy[k]!, table.vz[k]!);
}

function runSequence(children: readonly Segment[], input: MissionState | null, env: MissionEnv, opts: RunOpts): SegmentResult {
  let state = input;
  const samples: StateSample[] = [];
  const reports: DcReport[] = [];
  const optReports: OptimizerReport[] = [];
  let status: SegmentStatus = { kind: 'ok' };
  let stmAt: ((et: number) => Float64Array) | undefined;
  let stmEpoch: number | undefined;
  for (const child of children) {
    const r = runSegment(child, state, env, opts);
    state = r.out;
    appendSamples(samples, r.samples);
    if (r.targetReports) reports.push(...r.targetReports);
    if (r.optimizerReports) optReports.push(...r.optimizerReports);
    if (r.stmAt) {
      stmAt = r.stmAt; // the last STM-bearing segment owns the arc to the eval state
      stmEpoch = r.stmEpoch;
    }
    status = r.status;
    if (r.halt) return { out: state, samples, status, halt: true, targetReports: reports, optimizerReports: optReports, stmAt, stmEpoch };
  }
  if (!state) throw new MissingInitialStateError([]);
  return { out: state, samples, status, halt: false, targetReports: reports, optimizerReports: optReports, stmAt, stmEpoch };
}

function runTarget(seg: TargetSegment, input: MissionState, env: MissionEnv): SegmentResult {
  const path = [...input.segmentPath, seg.id];
  const settings = { ...DEFAULT_DC_SETTINGS, ...seg.settings };
  const mu = env.dynamicsFor(input.centralBody).gm;
  const controls = bindControls(seg.children, seg.controls);
  const goals = bindGoals(seg.goals);
  const execOne = (s: Segment, state: MissionState, wantStm: boolean): SegmentResult =>
    runSegment(s, state, env, { stm: wantStm });
  const ctx = { children: seg.children, goals, input, env, mu, execOne };

  if (seg.objective) {
    // OPTIMIZER mode: satisfy the goals AND minimize the objective.
    const { report, solvedChildren } = runTargetOptimizer(seg.objective, controls, goals, ctx, settings, path);
    const replay = runSequence(solvedChildren, input, env, {});
    return {
      out: replay.out,
      samples: replay.samples,
      status: replay.status,
      halt: replay.halt,
      targetReports: replay.targetReports ?? [],
      optimizerReports: [report, ...(replay.optimizerReports ?? [])],
    };
  }

  const { report, solvedChildren } = runDifferentialCorrector(controls, goals, ctx, settings, path);

  // Replay the converged branch once (no STM) to publish its samples and final state.
  const replay = runSequence(solvedChildren, input, env, {});
  return { out: replay.out, samples: replay.samples, status: replay.status, halt: replay.halt, targetReports: [report, ...(replay.targetReports ?? [])], optimizerReports: replay.optimizerReports ?? [] };
}

export function runSegment(seg: Segment, input: MissionState | null, env: MissionEnv, opts: RunOpts = {}): SegmentResult {
  switch (seg.kind) {
    case 'InitialState': {
      if (seg.frame !== 'J2000') throw new NotImplementedError([seg.id], `frame ${seg.frame}`);
      const base: MissionState = { epoch: seg.epoch, r: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, mass: seg.mass, centralBody: seg.centralBody, segmentPath: [seg.id] };
      let state: MissionState;
      if (seg.coord.type === 'Cartesian') {
        state = { ...base, r: seg.coord.r, v: seg.coord.v };
      } else {
        const { r, v } = coe2rv(env.dynamicsFor(seg.centralBody).gm, seg.coord.el);
        state = { ...base, r, v };
      }
      return { out: state, samples: [sampleOf(state)], status: { kind: 'ok' }, halt: false };
    }
    case 'Propagate':
      if (!input) throw new MissingInitialStateError([seg.id]);
      return runPropagate(seg, input, env, opts);
    case 'Maneuver': {
      if (!input) throw new MissingInitialStateError([seg.id]);
      if (seg.mode === 'Finite') {
        const baseModel = env.twoBodyModel(input.centralBody);
        const burn = runFiniteBurn(seg, input, baseModel, env.integratorOptions, 33);
        const samples = burn.samples.map((p) => ({ et: p.et, state: { position: p.r, velocity: p.v } }));
        return { out: burn.out, samples, status: { kind: 'ok' }, halt: false };
      }
      const out = applyImpulsive(input, seg);
      return { out, samples: [sampleOf(out)], status: { kind: 'ok' }, halt: false };
    }
    case 'Sequence':
      return runSequence(seg.children, input, env, opts);
    case 'Target':
      if (!input) throw new MissingInitialStateError([seg.id]);
      return runTarget(seg, input, env);
    case 'Stop':
      if (!input) throw new MissingInitialStateError([seg.id]);
      return { out: input, samples: [], status: { kind: 'ok' }, halt: true };
  }
}

export function runMcs(mcs: Mcs, env: MissionEnv): McsRun {
  const result = runSegment(mcs.root, null, env);
  return { final: result.out, samples: result.samples, targetReports: result.targetReports ?? [], optimizerReports: result.optimizerReports ?? [] };
}

/** Async public entry (the math is synchronous; async mirrors the rest of the engine API). */
export async function runMission(mcs: Mcs, env: MissionEnv): Promise<McsRun> {
  return runMcs(mcs, env);
}
