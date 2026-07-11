// The editable-MCS segment-editor reducer is pure and tested: add / remove / reorder / patch
// each return a new EditableMcs, and compileEditableMcs lowers a valid list to a runnable Mcs
// IR (failing loudly when it cannot). runEditableMcs then converges the corrector on the goal.
// (analysis-UX Phase 1.)

import { describe, expect, it } from 'vitest';
import {
  defaultEditableMcs,
  mcsEditorReducer,
  newSegment,
  type EditableMcs,
} from './mcs-editor.ts';
import { compileEditableMcs, McsEditorError } from './mcs-compile.ts';
import { runEditableMcs } from './mcs.ts';
import { validateMcs } from '@bessel/propagator';

describe('mcsEditorReducer (pure)', () => {
  it('adds a segment of the requested kind, appended to the list', () => {
    const start: EditableMcs = { segments: [{ kind: 'InitialState', id: 'init', altitudeKm: 500 }] };
    const next = mcsEditorReducer(start, { type: 'add', kind: 'Propagate' });
    expect(next.segments).toHaveLength(2);
    expect(next.segments[1]?.kind).toBe('Propagate');
    // Pure: the input is not mutated.
    expect(start.segments).toHaveLength(1);
  });

  it('removes a segment by id', () => {
    const start = defaultEditableMcs();
    const next = mcsEditorReducer(start, { type: 'remove', id: 'coast1' });
    expect(next.segments.find((s) => s.id === 'coast1')).toBeUndefined();
    expect(next.segments).toHaveLength(start.segments.length - 1);
  });

  it('reorders a segment up and clamps at the ends', () => {
    const start = defaultEditableMcs();
    const up = mcsEditorReducer(start, { type: 'move', id: 'burn', dir: -1 });
    expect(up.segments.map((s) => s.id)).toEqual(['init', 'burn', 'coast1', 'target']);
    // Moving the first segment up is a no-op (clamped), returning the same state.
    const clamped = mcsEditorReducer(start, { type: 'move', id: 'init', dir: -1 });
    expect(clamped).toBe(start);
  });

  it('patches a segment param without changing its kind or id', () => {
    const start = defaultEditableMcs();
    const next = mcsEditorReducer(start, { type: 'patch', id: 'init', patch: { altitudeKm: 700 } });
    const init = next.segments[0];
    expect(init?.kind).toBe('InitialState');
    expect(init?.id).toBe('init');
    if (init?.kind === 'InitialState') expect(init.altitudeKm).toBe(700);
  });

  it('newSegment yields fresh defaults per kind', () => {
    expect(newSegment('Maneuver').kind).toBe('Maneuver');
    expect(newSegment('Target').kind).toBe('Target');
  });
});

describe('compileEditableMcs (lowering)', () => {
  it('lowers the default editable design to a valid Mcs IR', () => {
    const mcs = compileEditableMcs(defaultEditableMcs());
    expect(mcs.version).toBe(1);
    expect(mcs.root.children[0]?.kind).toBe('InitialState');
    // The default has 4 editable segments but the burn is consumed by the Target, so the
    // lowered children are: InitialState, Propagate, Target.
    expect(mcs.root.children.map((c) => c.kind)).toEqual(['InitialState', 'Propagate', 'Target']);
    expect(() => validateMcs(mcs)).not.toThrow();
  });

  it('fails loudly when the sequence does not start with an InitialState', () => {
    const design: EditableMcs = { segments: [{ kind: 'Propagate', id: 'p', durationSec: 600 }] };
    expect(() => compileEditableMcs(design)).toThrow(McsEditorError);
  });

  it('fails loudly when a Target has no preceding Maneuver to control', () => {
    const design: EditableMcs = {
      segments: [
        { kind: 'InitialState', id: 'init', altitudeKm: 500 },
        { kind: 'Target', id: 'target', goalType: 'Radius', desiredKm: 7200, toleranceKm: 1 },
      ],
    };
    expect(() => compileEditableMcs(design)).toThrow(/no preceding Maneuver/);
  });
});

describe('runEditableMcs (corrector convergence)', () => {
  it('runs the compiled default design and converges the corrector on the radius goal', async () => {
    const mcs = compileEditableMcs(defaultEditableMcs());
    const { result, arc } = await runEditableMcs(mcs);
    expect(arc.length).toBeGreaterThan(2);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    // The per-iteration residual trace and the solved delta-v are surfaced.
    expect(result.residualHistory.length).toBeGreaterThan(0);
    expect(result.solvedDvKmS).not.toBeNull();
    expect(Math.abs(result.finalRadiusKm - 7200)).toBeLessThan(1);
  });
});
