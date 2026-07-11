/**
 * Session 2 bake-off measurement: state and orientation error of the cosmolabe
 * core against SPICE truth, quantified (the second bake-off measurement of
 * docs/design/02 section 3; the heritage Layer 1 oracle asserts tolerances,
 * this rig records the numbers for the M-0001 evidence table).
 *
 * Method mirrors the unmodified heritage oracle
 * (packages/core/src/__tests__/spice-oracle.test.ts): per-leg relative
 * position, absolutePositionOf(body) minus absolutePositionOf(center), versus
 * SPICE spkpos through SPICE's own frame machinery, same kernels, same
 * correction (NONE); pole orientation via the composed body to world
 * quaternion versus the pxform IAU pole. Position error is the maximum over
 * the fingerprint epoch sweep (offsets -12h to +12h around the scene epoch,
 * inside the SOI kernel window).
 *
 * Emits docs/validation/data/state-error.json. Driven by
 * scripts/state-error.mjs under the pinned environment.
 */
import { test, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENES, buildScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/scenes.js';
import {
  composeBodyToWorldQuat,
  rotateVecByQuat,
  type Vec3,
} from '../../cosmolabe/packages/core/src/kinematics.js';

const OUT = resolve(process.env.RIG_OUT ?? 'docs/validation/data');
const OFFSETS_HR = [-12, -6, 0, 6, 12];

const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: number[]): number => Math.hypot(v[0], v[1], v[2]);
const angleDeg = (a: number[], b: number[]): number => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(Math.min(1, Math.max(-1, d / (norm(a) * norm(b))))) * 180) / Math.PI;
};

test('state and orientation error vs SPICE truth (saturn-soi oracle bodies)', async () => {
  const def = SCENES['saturn-soi'];
  const { universe, spice, et } = await buildScene('saturn-soi');
  expect(spice).toBeDefined();

  const rows = [];
  for (const ob of def.oracleBodies) {
    const body = universe.getBody(ob.name)!;
    let maxPosErrKm = 0;
    for (const hr of OFFSETS_HR) {
      const t = et + hr * 3600;
      const ours = sub(
        universe.absolutePositionOf(ob.name, t),
        universe.absolutePositionOf(body.parentName!, t),
      );
      const truth = spice!.spkpos(ob.spiceName, t, 'ECLIPJ2000', 'NONE', ob.spiceCenter).position;
      maxPosErrKm = Math.max(maxPosErrKm, norm(sub(ours, truth)));
    }

    let poleErrDeg: number | null = null;
    if (ob.hasPole) {
      const q = body.rotationAt(et)!;
      const bw = composeBodyToWorldQuat(q, body.rotation!.sourceFrame);
      const poleOurs = rotateVecByQuat([0, 0, 1], bw);
      const m = spice!.pxform('ECLIPJ2000', `IAU_${ob.spiceName}`, et);
      poleErrDeg = angleDeg(poleOurs, [m[6], m[7], m[8]]);
    }

    rows.push({
      body: ob.name,
      center: ob.spiceCenter,
      correction: 'NONE',
      epochs: OFFSETS_HR.length,
      maxPosErrKm: Number(maxPosErrKm.toPrecision(3)),
      maxPosErrM: Number((maxPosErrKm * 1000).toPrecision(3)),
      poleErrDeg: poleErrDeg === null ? null : Number(poleErrDeg.toPrecision(3)),
      poleErrArcsec: poleErrDeg === null ? null : Number((poleErrDeg * 3600).toPrecision(3)),
    });
    expect(Number.isFinite(maxPosErrKm)).toBe(true);
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'state-error.json'),
    JSON.stringify(
      {
        description:
          'Cosmolabe core state and orientation error vs SPICE truth on saturn-soi (GS-2 analog): per-leg relative position vs spkpos (ECLIPJ2000, correction NONE), max over the -12h..+12h sweep; composed pole vs the pxform IAU pole at the scene epoch.',
        scene: 'saturn-soi',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
});
