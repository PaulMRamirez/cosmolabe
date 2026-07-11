import { describe, it, expect } from 'vitest';
import {
  assembleConstraints,
  computeFovWindows,
  resolveTerrainDem,
  parseTargetList,
  OpsAccessError,
} from './ops-access.ts';
import { DEFAULT_ACCESS_CONSTRAINTS, type AccessConstraintSpec } from './analysis-defaults.ts';
import { createAppStore } from '../store/index.ts';
import type { EphemerisTable } from '../sampler.ts';
import type { EngineCore } from './bootstrap.ts';

// assembleConstraints is a pure UI-spec -> AccessConstraint[] reducer; the in-FOV op test
// drives the store-write shape over a hand-built ephemeris table with the access stack empty
// (so computeAccess returns the whole span without touching a SPICE geometry finder).

const DEG = Math.PI / 180;

describe('assembleConstraints (pure constraint-array assembly)', () => {
  it('emits only the enabled members, in a stable order', () => {
    const spec: AccessConstraintSpec = {
      losEnabled: true,
      rangeEnabled: true,
      rangeMinKm: 100,
      rangeMaxKm: 9000,
      rangeRateEnabled: true,
      rangeRateMinKmS: -5,
      rangeRateMaxKmS: 5,
      sunKeepoutEnabled: true,
      sunKeepoutDeg: 30,
      azElMaskEnabled: false,
      terrainLosEnabled: false,
      terrainSource: 'none',
    };
    const out = assembleConstraints(spec, 'EARTH');
    expect(out.map((l) => l.constraint.kind)).toEqual([
      'lineOfSight',
      'range',
      'rangeRate',
      'sunExclusion',
    ]);
    // The line-of-sight occulting body and frame come from the center body.
    expect(out[0]!.constraint).toMatchObject({ body: 'EARTH', bodyFrame: 'IAU_EARTH' });
    // The sun keep-out is converted from degrees to radians.
    const sun = out[3]!.constraint;
    expect(sun.kind === 'sunExclusion' && Math.abs(sun.keepoutRad - 30 * DEG) < 1e-12).toBe(true);
  });

  it('drops disabled members (empty stack when none enabled)', () => {
    const none: AccessConstraintSpec = {
      ...DEFAULT_ACCESS_CONSTRAINTS,
      losEnabled: false,
    };
    expect(assembleConstraints(none, 'EARTH')).toHaveLength(0);
  });

  it('fails loud on an inverted range band', () => {
    const bad: AccessConstraintSpec = {
      ...DEFAULT_ACCESS_CONSTRAINTS,
      rangeEnabled: true,
      rangeMinKm: 9000,
      rangeMaxKm: 100,
    };
    expect(() => assembleConstraints(bad, 'EARTH')).toThrow(OpsAccessError);
  });

  it('fails loud on a non-positive sun keep-out', () => {
    const bad: AccessConstraintSpec = {
      ...DEFAULT_ACCESS_CONSTRAINTS,
      sunKeepoutEnabled: true,
      sunKeepoutDeg: 0,
    };
    expect(() => assembleConstraints(bad, 'EARTH')).toThrow(OpsAccessError);
  });

  it('UNGATES terrain LOS when a terrain source is chosen, threading a DEM into the constraint', () => {
    const spec: AccessConstraintSpec = {
      ...DEFAULT_ACCESS_CONSTRAINTS,
      losEnabled: false,
      terrainLosEnabled: true,
      terrainSource: 'sample-ridge',
    };
    const out = assembleConstraints(spec, 'MARS');
    expect(out).toHaveLength(1);
    const c = out[0]!.constraint;
    expect(c.kind).toBe('terrainLos');
    // The constraint carries the center body, its body-fixed frame, and a real DEM (heightAt).
    expect(c).toMatchObject({ body: 'MARS', bodyFrame: 'IAU_MARS' });
    if (c.kind === 'terrainLos') {
      expect(typeof c.dem.heightAt).toBe('function');
      expect(c.dem.heightAt(0, 0)).toBeGreaterThan(0);
    }
  });

  it('fails loud when terrain LOS is enabled but no terrain source is selected', () => {
    const bad: AccessConstraintSpec = {
      ...DEFAULT_ACCESS_CONSTRAINTS,
      terrainLosEnabled: true,
      terrainSource: 'none',
    };
    expect(() => assembleConstraints(bad, 'EARTH')).toThrow(OpsAccessError);
  });
});

describe('resolveTerrainDem', () => {
  it('returns the sample ridge DEM for sample-ridge and null for none', () => {
    expect(resolveTerrainDem('none')).toBeNull();
    const dem = resolveTerrainDem('sample-ridge');
    expect(dem).not.toBeNull();
    expect(dem!.heightAt(0, 0)).toBeGreaterThan(0);
  });
});

describe('parseTargetList', () => {
  it('splits on commas/whitespace, trims, and de-duplicates while preserving order', () => {
    expect(parseTargetList('Saturn, Titan  Sun, Titan')).toEqual(['Saturn', 'Titan', 'Sun']);
    expect(parseTargetList('   ')).toEqual([]);
  });
});

// A two-sample ephemeris table where the target sits exactly along the nadir boresight (so it
// is in the FOV for the whole span), built directly from the EphemerisTable shape.
function buildTable(): EphemerisTable {
  const flat = (x: number, y: number, z: number): Float64Array =>
    new Float64Array([x, y, z, x, y, z]);
  const byBody = new Map<string, Float64Array>([
    ['Probe', flat(0, 0, 1000)],
    ['Earth', flat(0, 0, 0)], // nadir reference: directly "below" the spacecraft
    ['Sun', flat(0, 0, -1e8)],
  ]);
  return { et0: 0, et1: 60, steps: 2, times: new Float64Array([0, 60]), byBody };
}

function fakeCore(table: EphemerisTable): EngineCore {
  // A minimal EngineCore: only the fields computeFovWindows reads. Cast through unknown so the
  // test does not have to stand up a real scene/spice; this is a focused store-shape assertion.
  const core = {
    table,
    clock: { state: { et: 0 } },
    identity: { spacecraftName: 'Probe', centerBody: 'Earth' },
    instrument: {
      descriptor: { name: 'TestCam' },
      // A 10 deg half-angle cone about the +Z boresight (one boundary ray at 10 deg).
      fov: {
        boresight: [0, 0, 1] as const,
        bounds: [[Math.sin(10 * DEG), 0, Math.cos(10 * DEG)] as const],
      },
    },
    // computeFovWindows calls computeAccess with an empty stack (constraints all off), which
    // returns the whole span and never touches the spice geometry finders.
    spice: {},
  } as unknown as EngineCore;
  return core;
}

describe('computeFovWindows (in-FOV store-write shape)', () => {
  it('stores a FOV-only window and a post-constraint surviving window over the span', async () => {
    const store = createAppStore();
    const table = buildTable();
    const core = fakeCore(table);
    const spec: AccessConstraintSpec = { ...DEFAULT_ACCESS_CONSTRAINTS, losEnabled: false };
    await computeFovWindows(core, store, () => false, 'nadir', spec, undefined, {
      spanSec: 60,
      stepSec: 30,
    });
    const s = store.getState();
    // The target is along nadir for the whole span, so the FOV-only window covers it fully.
    expect(s.fovResult).not.toBeNull();
    expect(s.fovResult!.window).toEqual([[0, 60]]);
    expect(s.fovResult!.span).toEqual([0, 60]);
    expect(s.fovResult!.fom.percentCoverage).toBeGreaterThan(0.99);
    expect(s.fovResult!.label).toContain('nadir-pointed');
    // With no access constraints the surviving window equals the FOV-only window.
    expect(s.fovSurviving).not.toBeNull();
    expect(s.fovSurviving!.window).toEqual([[0, 60]]);
  });

  it('clears the result when no instrument is loaded', async () => {
    const store = createAppStore();
    const core = { ...fakeCore(buildTable()), instrument: null } as EngineCore;
    await computeFovWindows(core, store, () => false, 'nadir', DEFAULT_ACCESS_CONSTRAINTS);
    expect(store.getState().fovResult).toBeNull();
    expect(store.getState().fovSurviving).toBeNull();
  });
});
