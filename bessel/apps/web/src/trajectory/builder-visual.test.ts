// Phase D visual honoring (C16/C17): buildCatalogMissionScene must reflect a
// catalog spacecraft trajectoryPlot.color in the built trajectory colors (not the
// synthesized blue ramp), and must honor a per-item label (show:false omits the
// label; text/color override the derived one). Real CSPICE with fixture kernels,
// asserted by the produced SceneSpec, never by judgement (Phase B builder style).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import type { BesselCatalog, Label, TrajectoryPlot } from '@bessel/catalog';
import { buildCatalogMissionScene } from '../generic-mission.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../kernels/fixtures/${name}`, import.meta.url))));

const GM_EARTH = 398600.435436;
const WINDOW = { start: '2004-07-01T00:00:00', stop: '2004-07-01T03:00:00' };

function craftCatalog(overrides: {
  trajectoryPlot?: TrajectoryPlot;
  scLabel?: Label;
  earthLabel?: Label;
}): BesselCatalog {
  return {
    version: '1.0',
    bodies: [{ id: '399', name: 'Earth', ...(overrides.earthLabel ? { label: overrides.earthLabel } : {}) }],
    spacecraft: [
      {
        id: '-9100',
        name: 'Sat',
        ...(overrides.scLabel ? { label: overrides.scLabel } : {}),
        ...(overrides.trajectoryPlot ? { trajectoryPlot: overrides.trajectoryPlot } : {}),
        trajectory: {
          type: 'Keplerian',
          center: '399',
          mu: GM_EARTH,
          elements: { a: 7000, e: 0, i: 0.9, raan: 0, argp: 0, m0: 0, epoch: WINDOW.start },
        },
        arcs: [{ timeRange: WINDOW, trajectory: { type: 'Spice' } }],
      },
    ],
  };
}

describe('buildCatalogMissionScene honors catalog trajectoryPlot and label', () => {
  let spice: SpiceEngine;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc', 'de440s-inner-cassini.bsp']) {
      await spice.furnsh(k, fixture(k));
    }
  });

  it('reflects trajectoryPlot.color in the trajectory colors instead of the ramp', async () => {
    // Pure red, no fade: every vertex must be exactly red, which the synthesized blue
    // ramp never produces.
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ trajectoryPlot: { color: '#ff0000' } }),
    );
    const colors = mission.spec.trajectory?.colors ?? [];
    expect(colors.length).toBeGreaterThan(2);
    for (const c of colors) {
      expect(c[0]).toBeCloseTo(1, 6);
      expect(c[1]).toBeCloseTo(0, 6);
      expect(c[2]).toBeCloseTo(0, 6);
    }
  });

  it('fades the declared color along the trail when fade is set', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ trajectoryPlot: { color: '#ff0000', fade: 1 } }),
    );
    const colors = mission.spec.trajectory?.colors ?? [];
    expect(colors.length).toBeGreaterThan(2);
    // The oldest (first) vertex is darkened to black; the newest (last) is full red.
    expect(colors[0]![0]).toBeCloseTo(0, 6);
    expect(colors[colors.length - 1]![0]).toBeCloseTo(1, 6);
  });

  it('keeps the synthesized blue ramp when no trajectoryPlot is declared', async () => {
    const mission = await buildCatalogMissionScene(spice, craftCatalog({}));
    const colors = mission.spec.trajectory?.colors ?? [];
    expect(colors.length).toBeGreaterThan(2);
    // The ramp ends bright blue (b dominant), never the pure-red plot color.
    const last = colors[colors.length - 1]!;
    expect(last[2]).toBeGreaterThan(last[0]);
  });

  it('bounds the drawn arc by trajectoryPlot.sampleCount', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ trajectoryPlot: { sampleCount: 12 } }),
    );
    expect(mission.spec.trajectory?.points.length).toBe(12);
  });

  it('omits a label when the item declares label.show:false', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ scLabel: { show: false } }),
    );
    const ids = mission.spec.labels?.map((l) => l.id) ?? [];
    expect(ids).not.toContain('Sat');
    // Earth (no override) keeps its derived label.
    expect(ids).toContain('Earth');
  });

  it('uses the declared label text and color when present', async () => {
    const mission = await buildCatalogMissionScene(
      spice,
      craftCatalog({ earthLabel: { text: 'Terra', color: '#00ff00' } }),
    );
    const earth = mission.spec.labels?.find((l) => l.anchorBody === 'Earth');
    expect(earth?.text).toBe('Terra');
    expect(earth?.color).toBe('#00ff00');
  });
});
