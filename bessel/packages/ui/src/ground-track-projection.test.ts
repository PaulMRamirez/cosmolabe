// The pure ground-track projection + station-placement math: each of the three selectable
// projections maps lon/lat (radians) into the [0,w] x [0,h] SVG box, north up, and station
// markers are placed (or dropped when off the projection's drawable band).

import { describe, it, expect } from 'vitest';
import { projectToBox, placeStations, type GroundTrackProjection } from './ground-track-projection.ts';

const W = 280;
const H = 140;

describe('projectToBox', () => {
  it('maps the origin (lon=0, lat=0) to the box center in every projection', () => {
    for (const kind of ['equirectangular', 'mercator', 'polar-stereographic'] as const) {
      const p = projectToBox(0, 0, kind, W, H);
      // The prime-meridian + equator origin sits at the horizontal center in all three; the
      // vertical center for the two cylindrical projections (the polar disk centers the pole).
      expect(p.x).toBeCloseTo(W / 2, 6);
      if (kind !== 'polar-stereographic') expect(p.y).toBeCloseTo(H / 2, 6);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it('puts the antimeridian extremes at the box edges (equirectangular)', () => {
    expect(projectToBox(-Math.PI, 0, 'equirectangular', W, H).x).toBeCloseTo(0, 6);
    expect(projectToBox(Math.PI, 0, 'equirectangular', W, H).x).toBeCloseTo(W, 6);
  });

  it('places north above south in the box (y grows downward), equirectangular', () => {
    const north = projectToBox(0, 1.0, 'equirectangular', W, H);
    const south = projectToBox(0, -1.0, 'equirectangular', W, H);
    expect(north.y).toBeLessThan(south.y);
  });

  it('keeps mercator finite at high latitude by clamping to the projection limit', () => {
    const p = projectToBox(0, Math.PI / 2 - 1e-6, 'mercator', W, H);
    expect(Number.isFinite(p.y)).toBe(true);
    // The near-pole sample clamps to the projection limit, which sits at the top edge (y ~ 0).
    expect(p.y).toBeGreaterThanOrEqual(-1e-9);
    expect(p.y).toBeLessThanOrEqual(H);
  });

  it('maps the projection pole to the box center in polar stereographic', () => {
    const p = projectToBox(1.2, Math.PI / 2, 'polar-stereographic', W, H);
    expect(p.x).toBeCloseTo(W / 2, 6);
    expect(p.y).toBeCloseTo(H / 2, 6);
  });
});

describe('placeStations', () => {
  const stations = [
    { id: 'n', name: 'North', lonRad: 0, latRad: 0.9 },
    { id: 's', name: 'South', lonRad: 0, latRad: -1.2 },
  ];

  it('places every station for a cylindrical projection', () => {
    for (const kind of ['equirectangular', 'mercator'] as const) {
      expect(placeStations(stations, kind, W, H)).toHaveLength(2);
    }
  });

  it('drops a far-hemisphere station for polar stereographic rather than mis-placing it', () => {
    const placed = placeStations(stations, 'polar-stereographic', W, H);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.id).toBe('n');
  });

  it('returns finite box coordinates and carries the id/name through', () => {
    const kind: GroundTrackProjection = 'equirectangular';
    const placed = placeStations(stations, kind, W, H);
    for (const s of placed) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
      expect(typeof s.name).toBe('string');
    }
  });
});
