/**
 * Session 2 baseline capture: recompute the deterministic scene fingerprints
 * for every registered heritage scene and write them to RIG_OUT (default
 * tests/golden/pre-merge/fingerprints). Reuses the cosmolabe test harness
 * unchanged so the captured bytes are produced by exactly the code path the
 * heritage golden test pins; scripts/baseline drives this file and performs
 * the byte-for-byte compare against the committed baselines.
 */
import { test, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENES, buildScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/scenes.js';
import {
  fingerprintScene,
  serializeFingerprint,
} from '../../cosmolabe/packages/core/src/__tests__/_harness/fingerprint.js';

const OUT = resolve(process.env.RIG_OUT ?? 'tests/golden/pre-merge/fingerprints');

test('capture scene fingerprints', async () => {
  mkdirSync(OUT, { recursive: true });
  for (const sceneName of Object.keys(SCENES)) {
    const fp = fingerprintScene(await buildScene(sceneName), sceneName);
    writeFileSync(join(OUT, `${sceneName}.json`), serializeFingerprint(fp));
    expect(fp.bodies.length).toBeGreaterThan(0);
  }
});
