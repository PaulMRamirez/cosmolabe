// Attitude history sampler (the CK Type 3 analog) and the pxform-style query.
// Oracles (independent of the sampler's own math):
//   (1) quaternionToMatrix matches CSPICE q2m on the Cassini fixture engine, so the
//       pure rotation matches the validated SPICE convention (not self-referential).
//   (2) the sampled orientation reproduces each source quaternion EXACTLY at its
//       sample epoch (the round-trip recovers the profile).
//   (3) at a midpoint the SLERP query equals a hand-computed half-angle rotation.
//   (4) querying outside the span and a non-ascending history fail loudly.
// CK-binary IO is deferred (no ck* CSPICE-WASM exports); the AEM round-trip in
// @bessel/interop is the read/write path. (STK_PARITY_SPEC section 4.6 ATT-6/ATT-7.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { createSpiceEngine, type SpiceEngine } from '@bessel/spice';
import { attitudeHistory, quaternionToMatrix, AttitudeHistoryError, type Quaternion } from './index.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../kernels/fixtures/${name}`, import.meta.url))));

// A profile: identity, 90 deg about +X, 90 deg about +Z, at 0/60/120 s.
const Q0: Quaternion = [1, 0, 0, 0];
const QX90: Quaternion = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0, 0];
const QZ90: Quaternion = [Math.cos(Math.PI / 4), 0, 0, Math.sin(Math.PI / 4)];

describe('attitudeHistory + pxform-style query', () => {
  let spice: SpiceEngine;

  beforeAll(async () => {
    spice = await createSpiceEngine();
    for (const k of ['naif0012.tls', 'pck00011.tpc']) await spice.furnsh(k, fixture(k));
  });

  it('quaternionToMatrix matches CSPICE q2m (validated convention)', async () => {
    for (const q of [Q0, QX90, QZ90, [0.5, 0.5, 0.5, 0.5] as Quaternion]) {
      const mine = quaternionToMatrix(q);
      const ref = await spice.q2m(q as unknown as number[]);
      for (let i = 0; i < 9; i++) expect(mine[i]!).toBeCloseTo(ref[i]!, 12);
    }
  });

  it('recovers each source quaternion exactly at its sample epoch', () => {
    const hist = attitudeHistory([
      { et: 0, quaternion: Q0 },
      { et: 60, quaternion: QX90 },
      { et: 120, quaternion: QZ90 },
    ]);
    expect(hist.span).toEqual([0, 120]);
    for (const [et, q] of [
      [0, Q0],
      [60, QX90],
      [120, QZ90],
    ] as const) {
      const got = hist.quaternionAt(et);
      // SLERP normalizes and can flip sign; compare the rotation, not the raw sign.
      const m = quaternionToMatrix(got);
      const ref = quaternionToMatrix(q);
      for (let i = 0; i < 9; i++) expect(m[i]!).toBeCloseTo(ref[i]!, 9);
    }
  });

  it('SLERP-interpolates the midpoint to the half-angle rotation', () => {
    const hist = attitudeHistory([
      { et: 0, quaternion: Q0 },
      { et: 60, quaternion: QX90 },
    ]);
    // Halfway from identity to a 90 deg X rotation is a 45 deg X rotation.
    const mid = hist.quaternionAt(30);
    const expected: Quaternion = [Math.cos(Math.PI / 8), Math.sin(Math.PI / 8), 0, 0];
    const m = quaternionToMatrix(mid);
    const ref = quaternionToMatrix(expected);
    for (let i = 0; i < 9; i++) expect(m[i]!).toBeCloseTo(ref[i]!, 9);
  });

  it('pxformAt returns the orientation matrix at an epoch', () => {
    const hist = attitudeHistory([
      { et: 0, quaternion: Q0 },
      { et: 60, quaternion: QZ90 },
    ]);
    const m = hist.pxformAt(0);
    // Identity orientation at the first node.
    expect(m[0]).toBeCloseTo(1, 12);
    expect(m[4]).toBeCloseTo(1, 12);
    expect(m[8]).toBeCloseTo(1, 12);
  });

  it('fails loudly outside the span and on a non-ascending history', () => {
    const hist = attitudeHistory([{ et: 0, quaternion: Q0 }, { et: 60, quaternion: QX90 }]);
    expect(() => hist.quaternionAt(-1)).toThrow(AttitudeHistoryError);
    expect(() => hist.quaternionAt(61)).toThrow(AttitudeHistoryError);
    expect(() => attitudeHistory([])).toThrow(AttitudeHistoryError);
    expect(() =>
      attitudeHistory([{ et: 60, quaternion: Q0 }, { et: 0, quaternion: QX90 }]),
    ).toThrow(AttitudeHistoryError);
  });
});
