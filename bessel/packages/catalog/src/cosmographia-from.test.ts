// Full multi-item Cosmographia importer (Section 16, item 4). fromCosmographia
// classifies every item, maps all five trajectory forms, all four rotation forms,
// and every geometry type into a native catalog, then validates the assembled
// output against the schema. Bad references fail loudly with a located CatalogError.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CatalogError,
  cosmographiaRotationToNative,
  cosmographiaTrajectoryToNative,
  fromCosmographia,
} from './index.ts';

const multi = JSON.parse(
  readFileSync(fileURLToPath(new URL('../test/fixtures/cosmographia-multi.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

describe('cosmographiaTrajectoryToNative', () => {
  it('maps a Spice trajectory (with target/center/frame)', () => {
    expect(
      cosmographiaTrajectoryToNative({ type: 'Spice', target: '-82', center: '6', frame: 'J2000' }),
    ).toEqual({ type: 'Spice', target: '-82', center: '6', frame: 'J2000' });
  });

  it('maps InterpolatedStates to a Sampled trajectory', () => {
    expect(
      cosmographiaTrajectoryToNative({ type: 'InterpolatedStates', source: 's.xyz', format: 'xyz', center: '6' }),
    ).toEqual({ type: 'Sampled', source: 's.xyz', format: 'xyz', center: '6' });
  });

  it('maps Keplerian elements (Cosmographia long names) to the native element block', () => {
    expect(
      cosmographiaTrajectoryToNative({
        type: 'Keplerian',
        elements: {
          semiMajorAxis: 1221870,
          eccentricity: 0.0288,
          inclination: 0.0048,
          ascendingNode: 0.4,
          argumentOfPeriapsis: 0.3,
          meanAnomaly: 1.2,
          epoch: '2004-06-22T00:00:00Z',
        },
        center: '6',
      }),
    ).toEqual({
      type: 'Keplerian',
      elements: {
        a: 1221870,
        e: 0.0288,
        i: 0.0048,
        raan: 0.4,
        argp: 0.3,
        m0: 1.2,
        epoch: '2004-06-22T00:00:00Z',
      },
      center: '6',
    });
  });

  it('maps a two-line TLE to a Tle trajectory', () => {
    const t = cosmographiaTrajectoryToNative({
      type: 'TLE',
      line1: '1 25544U 98067A   04174.00000000  .00000000  00000-0  00000-0 0  9990',
      line2: '2 25544  51.6000 000.0000 0001000 000.0000 000.0000 15.50000000000000',
      center: '399',
    });
    expect(t.type).toBe('Tle');
    expect(t).toMatchObject({ center: '399' });
  });

  it('maps FixedPoint to a Fixed trajectory with a position', () => {
    expect(
      cosmographiaTrajectoryToNative({ type: 'FixedPoint', position: [1, 2, 3], center: '6' }),
    ).toEqual({ type: 'Fixed', position: [1, 2, 3], center: '6' });
  });

  it('fails loudly on an unknown trajectory type', () => {
    expect(() => cosmographiaTrajectoryToNative({ type: 'Wormhole' })).toThrow(CatalogError);
  });

  it('fails loudly when Keplerian elements are incomplete', () => {
    expect(() => cosmographiaTrajectoryToNative({ type: 'Keplerian', elements: { a: 1 } })).toThrow(CatalogError);
  });
});

describe('cosmographiaRotationToNative', () => {
  it('maps a Spice rotationModel', () => {
    expect(cosmographiaRotationToNative({ type: 'Spice', frame: 'IAU_SATURN' })).toEqual({
      type: 'Spice',
      frame: 'IAU_SATURN',
    });
  });

  it('maps a Fixed rotationModel with a quaternion', () => {
    expect(cosmographiaRotationToNative({ type: 'Fixed', quaternion: [0, 0, 0, 1] })).toEqual({
      type: 'Fixed',
      quaternion: [0, 0, 0, 1],
    });
  });

  it('maps a UniformRotation rotationModel', () => {
    expect(
      cosmographiaRotationToNative({ type: 'UniformRotation', axis: [0, 0, 1], rate: 0.1, epoch: '2004-01-01T00:00:00Z' }),
    ).toEqual({ type: 'UniformRotation', axis: [0, 0, 1], ratePerSec: 0.1, epoch: '2004-01-01T00:00:00Z' });
  });

  it('maps a TwoVector rotationModel (primary/secondary, axis + target)', () => {
    expect(
      cosmographiaRotationToNative({
        type: 'TwoVector',
        primary: { axis: 'z', target: '6' },
        secondary: { axis: [1, 0, 0], target: 'Sun' },
      }),
    ).toEqual({
      type: 'TwoVector',
      primary: { axis: 'z', target: '6' },
      secondary: { axis: [1, 0, 0], target: 'Sun' },
    });
  });

  it('fails loudly on an unknown rotation type', () => {
    expect(() => cosmographiaRotationToNative({ type: 'Tumbling' })).toThrow(CatalogError);
  });
});

describe('fromCosmographia (multi-item)', () => {
  it('imports every item type into a schema-valid native catalog', async () => {
    const catalog = await fromCosmographia(multi);

    // Bodies (no trajectory or non-spacecraft class with a trajectory).
    const bodyNames = (catalog.bodies ?? []).map((b) => b.name);
    expect(bodyNames).toEqual(expect.arrayContaining(['Saturn', 'Titan', 'Landmark', 'Swarm']));

    // Spacecraft (have a trajectory + a start/end window -> single arc).
    const sc = (catalog.spacecraft ?? []).find((s) => s.name === 'Orbiter');
    expect(sc?.arcs?.[0]?.timeRange).toEqual({
      start: '2004-06-22T00:00:00Z',
      stop: '2004-08-22T00:00:00Z',
    });
    expect(sc?.arcs?.[0]?.trajectory.type).toBe('Spice');
    // The orientation rides on the arc (so the trajectory-xor-arcs schema rule holds).
    expect(sc?.arcs?.[0]?.orientation?.type).toBe('UniformRotation');
    expect(sc?.trajectoryPlot?.color).toBe('#33ccff');
    expect(sc?.label?.text).toBe('Cassini');
    expect(sc?.mass).toEqual({ value: 2150, unit: 'kg' });

    // Each trajectory form reached the native union.
    const titan = (catalog.bodies ?? []).find((b) => b.name === 'Titan');
    expect(titan?.trajectory?.type).toBe('Keplerian');
    expect(titan?.geometry?.type).toBe('Mesh');
    expect(titan?.orientation?.type).toBe('TwoVector');
    const landmark = (catalog.bodies ?? []).find((b) => b.name === 'Landmark');
    expect(landmark?.trajectory?.type).toBe('Fixed');
    const swarm = (catalog.bodies ?? []).find((b) => b.name === 'Swarm');
    expect(swarm?.trajectory?.type).toBe('Sampled');
    expect(swarm?.geometry?.type).toBe('KeplerianSwarm');
    const tleSat = (catalog.spacecraft ?? []).find((s) => s.name === 'TleSat');
    expect(tleSat?.arcs?.[0]?.trajectory.type).toBe('Tle');

    // Saturn maps Globe + rings + a Spice rotation and the body mass string.
    const saturn = (catalog.bodies ?? []).find((b) => b.name === 'Saturn');
    expect(saturn?.geometry?.type).toBe('Globe');
    expect(saturn?.orientation).toEqual({ type: 'Spice', frame: 'IAU_SATURN' });
    expect(saturn?.mass).toBe('5.683e26 kg');

    // The two per-target sensor items collapse into one instrument with a targets array.
    expect(catalog.instruments).toHaveLength(1);
    // The sensor's parent name ("Orbiter") resolves to the spacecraft id ("-82").
    expect(catalog.instruments?.[0]).toMatchObject({
      id: 'Orbiter-Imager',
      parent: '-82',
      sensor: 'ORBITER_CAMERA',
    });
    expect(catalog.instruments?.[0]?.targets).toEqual(['Titan', 'Landmark']);

    // The observation maps with its interval and footprint color.
    expect(catalog.observations).toHaveLength(1);
    expect(catalog.observations?.[0]).toMatchObject({
      instrument: 'Orbiter-Imager',
      target: 'Titan',
      footprintColor: '#ff33cc',
    });

    // spiceKernels become kernels.paths.
    expect(catalog.kernels?.paths).toEqual(['spk/sat.bsp', 'lsk/naif.tls']);
  });

  it('throws a located CatalogError on a bad instrument parent reference', async () => {
    const bad = {
      version: '1.0',
      name: 'Bad',
      items: [
        { class: 'sensor', id: 'Cam', parent: 'NoSuchCraft', sensor: 'CAM', target: 'Titan' },
      ],
    };
    await expect(fromCosmographia(bad)).rejects.toBeInstanceOf(CatalogError);
  });

  it('throws a located CatalogError on an unsupported trajectory type', async () => {
    const bad = {
      version: '1.0',
      name: 'Bad',
      items: [{ class: 'spacecraft', name: 'X', id: 'X', trajectory: { type: 'Warp' } }],
    };
    await expect(fromCosmographia(bad)).rejects.toBeInstanceOf(CatalogError);
  });

  it('requires a non-empty items array', async () => {
    await expect(fromCosmographia({ version: '1.0', name: 'Empty', items: [] })).rejects.toBeInstanceOf(
      CatalogError,
    );
  });
});
