import { describe, expect, it, vi } from 'vitest';
import { buildScene, type SceneTarget } from './scene-builder.ts';
import type { SceneSpec } from './scene-spec.ts';
import { SOLAR_SYSTEM } from './planets.ts';

function recordingTarget(): SceneTarget & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      (calls[name] ??= []).push(args);
    };
  return {
    calls,
    setBodies: record('setBodies') as SceneTarget['setBodies'],
    setSpacecraft: record('setSpacecraft') as SceneTarget['setSpacecraft'],
    setTrajectory: record('setTrajectory') as SceneTarget['setTrajectory'],
    setOrbits: record('setOrbits') as SceneTarget['setOrbits'],
    setStarField: record('setStarField') as SceneTarget['setStarField'],
    setRings: record('setRings') as SceneTarget['setRings'],
    setAxisTriad: record('setAxisTriad') as SceneTarget['setAxisTriad'],
    setAtmosphere: record('setAtmosphere') as SceneTarget['setAtmosphere'],
    setAtmosphereVisible: record('setAtmosphereVisible') as SceneTarget['setAtmosphereVisible'],
    setDirectionVectors: record('setDirectionVectors') as SceneTarget['setDirectionVectors'],
    setParticleSystems: record('setParticleSystems') as SceneTarget['setParticleSystems'],
    setKeplerianSwarms: record('setKeplerianSwarms') as SceneTarget['setKeplerianSwarms'],
    setTimeSwitched: record('setTimeSwitched') as SceneTarget['setTimeSwitched'],
    setLabels: record('setLabels') as SceneTarget['setLabels'],
    centerOn: record('centerOn') as SceneTarget['centerOn'],
    setView: record('setView') as SceneTarget['setView'],
  };
}

describe('buildScene', () => {
  it('applies bodies and an optional spacecraft, trajectory, rings, and camera', () => {
    const target = recordingTarget();
    const spec: SceneSpec = {
      bodies: SOLAR_SYSTEM,
      spacecraft: { name: 'Cassini' },
      trajectory: { points: [[1, 2, 3]], anchorBody: 'Saturn' },
      rings: [{ body: 'Saturn', innerKm: 100, outerKm: 200 }],
      camera: { focus: 'Saturn', azimuth: 0.6, elevation: 0.35, distance: 0.7 },
    };
    buildScene(target, spec);

    expect(target.calls['setBodies']?.[0]?.[0]).toBe(SOLAR_SYSTEM);
    expect(target.calls['setSpacecraft']?.[0]).toEqual(['Cassini', undefined]);
    expect(target.calls['setTrajectory']?.[0]).toEqual([[[1, 2, 3]], 'Saturn', undefined]);
    expect(target.calls['setRings']?.[0]).toEqual(['Saturn', 100, 200, undefined, undefined]);
    // A (re)build snaps the camera (animate=false) rather than flying from the old view.
    expect(target.calls['centerOn']?.[0]).toEqual(['Saturn', false]);
    expect(target.calls['setView']?.[0]).toEqual([0.6, 0.35, 0.7, false]);
  });

  it('passes per-vertex trajectory colors through to setTrajectory', () => {
    const target = recordingTarget();
    buildScene(target, {
      bodies: [],
      trajectory: { points: [[0, 0, 0], [1, 1, 1]], anchorBody: 'Saturn', colors: [[0, 0, 0], [1, 1, 1]] },
    });
    expect(target.calls['setTrajectory']?.[0]?.[2]).toEqual([[0, 0, 0], [1, 1, 1]]);
  });

  it('substitutes an identity rotation when an axis triad omits one', () => {
    const target = recordingTarget();
    buildScene(target, {
      bodies: [],
      axisTriads: [{ id: 'a', body: 'Saturn', lengthKm: 1000 }],
    });
    expect(target.calls['setAxisTriad']?.[0]).toEqual([
      'a',
      'Saturn',
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      1000,
    ]);
  });

  it('toggles atmosphere visibility from the spec', () => {
    const target = recordingTarget();
    buildScene(target, {
      bodies: [],
      atmospheres: [{ body: 'Saturn', innerKm: 1, outerKm: 2, sunDirection: [1, 0, 0], visible: false }],
    });
    expect(target.calls['setAtmosphere']?.[0]).toEqual(['Saturn', 1, 2, { sunDirection: [1, 0, 0] }]);
    expect(target.calls['setAtmosphereVisible']?.[0]).toEqual([false]);
  });

  it('does not abort the build when the star field throws', () => {
    const target = recordingTarget();
    target.setStarField = vi.fn(() => {
      throw new Error('bad buffer');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildScene(target, { bodies: SOLAR_SYSTEM, starField: [], camera: { focus: 'Sun', azimuth: 0, elevation: 0, distance: 1 } });
    // The camera still gets applied after the star field failure.
    expect(target.calls['setView']).toHaveLength(1);
    errSpy.mockRestore();
  });
});
