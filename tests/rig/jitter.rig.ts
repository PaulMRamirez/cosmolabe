/**
 * Session 2 jitter scaffold: quantify float32 render-origin jitter against a
 * float64 reference at the device-tier boundaries, on the bake-off scenes
 * (the measurement M-0001 and M-0003 cite; see docs/design/02 section 3).
 *
 * Model. On the GPU, geometry buffers and modelView matrix elements are
 * float32; cosmolabe defeats the resulting quantization by rebasing the scene
 * on an origin body every frame and baking origin-relative offsets into
 * vertices in float64 km (UniverseRenderer.updateFrame). The scaffold
 * reproduces that arithmetic headlessly: positions come from the unmodified
 * heritage harness scenes in float64 km (EclipticJ2000), are made relative to
 * a render origin, scaled by the renderer's km to scene-unit factor (1e-6),
 * quantized to float32, and pushed through a float32 view transform and
 * perspective projection (60 degree vertical fov, the renderer's camera). The
 * float64 reference runs the identical chain unquantized. The camera sits a
 * fixed 1000 km from the target and tracks it, so the target projects to the
 * exact screen center in the reference; the float32 screen-space deviation
 * from center, in device pixels, is the jitter.
 *
 * Three origin modes per target: 'tracked' (origin is the target body, the
 * cosmolabe architecture), 'parent' (origin is the target's primary, the
 * worst case the architecture still permits, for example looking at a moon
 * while tracking the planet), and 'none' (no rebase, heliocentric float32
 * coordinates, the GS-1 style counterfactual that shows why origin management
 * is a spine property). 'none' is reported but not gated: it is the failure
 * the architecture exists to prevent.
 *
 * Emits a machine-readable table to $RIG_OUT/jitter.json for the differential
 * harness to badge later. Driven by scripts/jitter-scaffold.mjs.
 */
import { test, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/scenes.js';

const OUT = resolve(process.env.RIG_OUT ?? 'docs/validation/data');

// Renderer constants (cosmolabe/packages/three/src/UniverseRenderer.ts).
const KM_TO_SCENE = 1e-6;
const FOV_DEG = 60;

// Device-tier boundaries from the bake-off protocol (docs/design/02 sections
// 3 and 7): CSS viewport times the profile ladder's DPR cap gives device
// pixels, the unit the envelope gates.
const TIERS = [
  { tier: 'A', device: 'M-series laptop', css: [1512, 982], dpr: 2.0 },
  { tier: 'B', device: 'mid-range tablet', css: [1194, 834], dpr: 2.0 },
  { tier: 'C', device: 'iPhone 13 class', css: [390, 844], dpr: 1.5 },
] as const;
const ENVELOPE_PX = 0.5; // sub-pixel: invisible at every tier

const CAMERA_DISTANCE_KM = 1000;
const SWEEP_STEPS = 120;
const SWEEP_DT_SEC = 1;
const AU_KM = 149597870.7;

type Vec3 = [number, number, number];
const f = Math.fround;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const f3 = (a: Vec3): Vec3 => [f(a[0]), f(a[1]), f(a[2])];

/** Row-major 3x3 rotation whose rows are the camera basis (right, up, back). */
function lookAtRotation(cam: Vec3, target: Vec3, up: Vec3): number[][] {
  const forward = normalize(sub(target, cam));
  const right = normalize(cross(forward, up));
  const trueUp = cross(right, forward);
  return [right, trueUp, scale(forward, -1)] as unknown as number[][];
}

/** float64 view transform and projection to device pixels. */
function project64(R: number[][], cam: Vec3, p: Vec3, heightPx: number): [number, number] {
  const rel = sub(p, cam);
  const v = [
    R[0][0] * rel[0] + R[0][1] * rel[1] + R[0][2] * rel[2],
    R[1][0] * rel[0] + R[1][1] * rel[1] + R[1][2] * rel[2],
    R[2][0] * rel[0] + R[2][1] * rel[1] + R[2][2] * rel[2],
  ];
  const tanHalf = Math.tan((FOV_DEG * Math.PI) / 360);
  const pxPerNdc = heightPx / 2;
  return [(v[0] / -v[2] / tanHalf) * pxPerNdc, (v[1] / -v[2] / tanHalf) * pxPerNdc];
}

/** The same chain with float32 storage and float32 arithmetic: quantized
 *  positions and matrix elements, fround after every multiply and add, the
 *  GPU's arithmetic on fp32 vertex buffers and modelView elements. */
function project32(R: number[][], cam: Vec3, p: Vec3, heightPx: number): [number, number] {
  const Rq = R.map((row) => row.map(f));
  const camQ = f3(cam);
  const pQ = f3(p);
  const rel: Vec3 = [f(pQ[0] - camQ[0]), f(pQ[1] - camQ[1]), f(pQ[2] - camQ[2])];
  const dot = (row: number[]): number =>
    f(f(f(row[0] * rel[0]) + f(row[1] * rel[1])) + f(row[2] * rel[2]));
  const v = [dot(Rq[0]), dot(Rq[1]), dot(Rq[2])];
  const tanHalf = f(Math.tan((FOV_DEG * Math.PI) / 360));
  const ndcX = f(f(v[0] / f(-v[2])) / tanHalf);
  const ndcY = f(f(v[1] / f(-v[2])) / tanHalf);
  // Viewport transform runs at full precision in hardware.
  return [ndcX * (heightPx / 2), ndcY * (heightPx / 2)];
}

interface Case {
  scenario: string;
  scene: string;
  target: string;
  originBody: string | null; // null: no rebase
  originMode: 'tracked' | 'parent' | 'none';
}

// GS-2 analog (Cassini at Saturn, the 9.5 AU float32 stressor of the bake-off
// protocol; measured heliocentric distance is reported per row) and the
// SPICE-free analytical scene (Moon at 1 AU). 'none' doubles as the GS-1
// heliocentric-cruise stress: float32 coordinates with a solar-system origin.
const CASES: Case[] = [
  { scenario: 'GS-2', scene: 'saturn-soi', target: 'Cassini', originBody: 'Cassini', originMode: 'tracked' },
  { scenario: 'GS-2', scene: 'saturn-soi', target: 'Cassini', originBody: 'Saturn', originMode: 'parent' },
  { scenario: 'GS-1', scene: 'saturn-soi', target: 'Cassini', originBody: null, originMode: 'none' },
  { scenario: 'GS-2', scene: 'saturn-soi', target: 'Enceladus', originBody: 'Enceladus', originMode: 'tracked' },
  { scenario: 'GS-2', scene: 'saturn-soi', target: 'Enceladus', originBody: 'Saturn', originMode: 'parent' },
  { scenario: 'analytical', scene: 'analytical-no-spice', target: 'Moon', originBody: 'Moon', originMode: 'tracked' },
  { scenario: 'analytical', scene: 'analytical-no-spice', target: 'Moon', originBody: 'Earth', originMode: 'parent' },
  { scenario: 'analytical', scene: 'analytical-no-spice', target: 'Moon', originBody: null, originMode: 'none' },
];

const CAMERA_DIR = normalize([0.3, -0.5, 0.81]);
const UP: Vec3 = [0, 0, 1];

test('jitter scaffold: float32 render-origin jitter vs float64 reference', async () => {
  const rows = [];
  const built = new Map<string, Awaited<ReturnType<typeof buildScene>>>();
  for (const c of CASES) {
    if (!built.has(c.scene)) built.set(c.scene, await buildScene(c.scene));
    const { universe, et } = built.get(c.scene)!;

    const targetAt = (t: number): Vec3 => universe.absolutePositionOf(c.target, t) as Vec3;
    const originAt = (t: number): Vec3 =>
      c.originBody ? (universe.absolutePositionOf(c.originBody, t) as Vec3) : [0, 0, 0];
    const helioAu = norm(targetAt(et)) / AU_KM;

    for (const tier of TIERS) {
      const heightPx = tier.css[1] * tier.dpr;
      let absMax = 0;
      let frameJitterMax = 0;
      const frameSteps: number[] = [];
      let prev: [number, number] | null = null;
      for (let k = 0; k <= SWEEP_STEPS; k++) {
        const t = et + k * SWEEP_DT_SEC;
        const tgt = targetAt(t);
        const org = originAt(t);
        const camWorld = add(tgt, scale(CAMERA_DIR, CAMERA_DISTANCE_KM));
        // Origin-relative scene units, the coordinates the GPU sees.
        const tgtScene = scale(sub(tgt, org), KM_TO_SCENE);
        const camScene = scale(sub(camWorld, org), KM_TO_SCENE);
        const R = lookAtRotation(camScene, tgtScene, UP);
        const ref = project64(R, camScene, tgtScene, heightPx);
        const f32 = project32(R, camScene, tgtScene, heightPx);
        const err: [number, number] = [f32[0] - ref[0], f32[1] - ref[1]];
        absMax = Math.max(absMax, Math.hypot(err[0], err[1]));
        if (prev) {
          const stepPx = Math.hypot(err[0] - prev[0], err[1] - prev[1]);
          frameJitterMax = Math.max(frameJitterMax, stepPx);
          frameSteps.push(stepPx);
        }
        prev = err;
      }
      frameSteps.sort((a, b) => a - b);
      const p95 = frameSteps[Math.floor(frameSteps.length * 0.95)] ?? 0;
      rows.push({
        scenario: c.scenario,
        scene: c.scene,
        target: c.target,
        heliocentricDistanceAu: Number(helioAu.toFixed(3)),
        cameraDistanceKm: CAMERA_DISTANCE_KM,
        originMode: c.originMode,
        originBody: c.originBody,
        tier: tier.tier,
        device: tier.device,
        viewportCss: `${tier.css[0]}x${tier.css[1]}`,
        dpr: tier.dpr,
        fovDeg: FOV_DEG,
        samples: SWEEP_STEPS + 1,
        dtSec: SWEEP_DT_SEC,
        absMaxPx: Number(absMax.toPrecision(3)),
        frameJitterMaxPx: Number(frameJitterMax.toPrecision(3)),
        frameJitterP95Px: Number(p95.toPrecision(3)),
        envelopePx: c.originMode === 'none' ? null : ENVELOPE_PX,
        gated: c.originMode !== 'none',
        pass: c.originMode === 'none' ? null : absMax <= ENVELOPE_PX,
      });
    }
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'jitter.json'),
    JSON.stringify(
      {
        description:
          'Float32 render-origin jitter vs float64 reference, device pixels, camera 1000 km from target, tracking; gated envelope 0.5 px; originMode none is the no-rebase counterfactual, reported ungated.',
        kmToSceneUnits: KM_TO_SCENE,
        envelopePx: ENVELOPE_PX,
        rows,
      },
      null,
      2,
    ) + '\n',
  );

  // The scaffold itself gates the architecture's operating modes.
  for (const r of rows.filter((r) => r.gated)) {
    expect(r.absMaxPx, `${r.scenario} ${r.target} ${r.originMode} tier ${r.tier}`).toBeLessThanOrEqual(ENVELOPE_PX);
  }
  expect(rows.length).toBe(CASES.length * TIERS.length);
});
