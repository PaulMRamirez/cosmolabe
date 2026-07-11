/**
 * Session 3 differential harness: the seam gate of ADR M-0002 (iron rule 3).
 * Both SPICE paths, cosmolabe's timecraftjs-based @cosmolabe/spice and the new
 * cspice-wasm layer behind the @cosmolabe/frames contracts, are driven over
 * the GS-1 (heliocentric cruise) and GS-2 (Cassini at Saturn, the saturn-soi
 * scene) fixtures with identical kernel bytes.
 *
 * Two modes, tolerances ratified in M-0002:
 *
 * Call-parity: identical CSPICE invocations through both wrappers (str2et vs
 * toEt, spkezr vs StateProvider.states, pxform vs FramesService.chain) must
 * agree to relative 1e-12. This mode asserts; a breach fails the rig and
 * therefore `pnpm verify`.
 *
 * Pipeline: each path through its own machinery (cosmolabe through Universe,
 * CatalogLoader, trajectory caching and interpolation via
 * absolutePositionOf and the composed rotation quaternions; the new layer
 * through the frames tier, which is deliberately cache-free). Deltas are
 * measured and reported against the 1 m position and 5 arcsec pointing
 * tripwires. Per the Session 3 goal this mode records, it does not assert:
 * green is required before any re-point merges, not before this session ends.
 * The tables carry within-tripwire flags so /seam and the gate read honestly.
 *
 * Emits docs/validation/data/seam-call-parity.json and seam-pipeline.json.
 * Driven by scripts/seam.mjs under the pinned environment.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENES, buildScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/scenes.js';
import { buildUniverseFromCatalog } from '../../cosmolabe/packages/core/src/__tests__/_harness/buildUniverse.js';
import { readKernelBuffer } from '../../cosmolabe/packages/core/src/__tests__/_harness/kernels.js';
import {
  composeBodyToWorldQuat,
  rotateVecByQuat,
} from '../../cosmolabe/packages/core/src/kinematics.js';
import type { CatalogJson } from '../../cosmolabe/packages/core/src/catalog/CatalogLoader.js';
import type { BuiltScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/buildUniverse.js';
import {
  createFramesLayer,
  type Correction,
  type FramesLayer,
} from '../../bessel/packages/frames/src/index.ts';
import {
  createSpiceBindings,
  type SpiceBindings,
} from '../../bessel/packages/cspice-wasm/src/index.ts';

const OUT = resolve(process.env.RIG_OUT ?? 'docs/validation/data');
const GATE_REL = 1e-12; // call-parity, M-0002
const TRIP_POS_M = 1; // pipeline position tripwire, M-0002
const TRIP_POINT_ARCSEC = 5; // pipeline pointing tripwire, M-0002
const CORRECTIONS: readonly Correction[] = ['NONE', 'LT', 'LT+S', 'CN', 'CN+S'];

// ── fixtures ─────────────────────────────────────────────────────────────────

// GS-2 is the saturn-soi harness scene and its SOI kernel, unchanged.
const GS2 = SCENES['saturn-soi'];
const GS2_OFFSETS_S = [-12, -6, 0, 6, 12].map((h) => h * 3600);
const GS2_PARITY = [
  { target: 'CASSINI', observer: 'SATURN', frame: 'ECLIPJ2000' },
  { target: 'TITAN', observer: 'SATURN', frame: 'J2000' },
  { target: 'SATURN', observer: 'SUN', frame: 'ECLIPJ2000' },
];
const GS2_FRAME_PAIRS = [
  ['ECLIPJ2000', 'J2000'],
  ['ECLIPJ2000', 'IAU_SATURN'],
  ['J2000', 'IAU_SATURN'],
];

// GS-1 is the Cassini cruise fixture: the 010420R_SCPSE_EP1_JP83 reconstruction
// (Earth flyby 1999-08-19 through 2001-03-23, past the Jupiter flyby), swept
// a month either side of a quiet mid-cruise epoch. The catalog is root-owned:
// the heritage scene registry is not touched this session (iron rule 2).
const GS1_TIME = '2000-06-01T00:00:00';
const GS1_KERNELS = ['naif0012.tls', 'pck00010.tpc', 'cassini/010420R_SCPSE_EP1_JP83.bsp'];
const GS1_OFFSETS_S = [-30, -15, 0, 15, 30].map((d) => d * 86400);
const GS1_PARITY = [
  { target: 'CASSINI', observer: 'SUN', frame: 'ECLIPJ2000' },
  { target: 'EARTH', observer: 'SUN', frame: 'J2000' },
  { target: 'JUPITER', observer: 'SUN', frame: 'J2000' },
];
const GS1_FRAME_PAIRS = [
  ['ECLIPJ2000', 'J2000'],
  ['J2000', 'IAU_EARTH'],
  ['ECLIPJ2000', 'IAU_JUPITER'],
];
const GS1_CATALOG: CatalogJson = {
  name: 'GS-1 heliocentric cruise (seam fixture)',
  defaultTime: GS1_TIME,
  items: [
    {
      name: 'Sun',
      class: 'star',
      trajectory: { type: 'FixedPoint', position: [0, 0, 0] },
      geometry: { type: 'Globe', radius: 695000 },
    },
    {
      name: 'Cassini',
      class: 'spacecraft',
      center: 'Sun',
      trajectoryFrame: 'J2000',
      trajectory: { type: 'Spice', target: 'CASSINI', center: 'SUN' },
    },
  ],
} as CatalogJson;

// ── helpers ──────────────────────────────────────────────────────────────────

const norm = (x: number, y: number, z: number): number => Math.hypot(x, y, z);

/** Relative delta between two 3-vectors: |a-b| / |b| (b the cosmolabe reference). */
const relVec = (a: readonly number[], b: readonly number[]): number =>
  norm(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) / norm(b[0]!, b[1]!, b[2]!);

const angleArcsec = (a: readonly number[], b: readonly number[]): number => {
  const dot =
    (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) /
    (norm(a[0]!, a[1]!, a[2]!) * norm(b[0]!, b[1]!, b[2]!));
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180 * 3600) / Math.PI;
};

const round = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(3)) : x);

async function buildFramesLayer(kernels: string[]): Promise<FramesLayer> {
  const frames = await createFramesLayer();
  for (const rel of kernels) {
    const buf = readKernelBuffer(rel);
    frames.furnish(rel.split('/').pop()!, new Uint8Array(buf));
  }
  return frames;
}

interface ScenarioCtx {
  scenario: string;
  scene: BuiltScene;
  frames: FramesLayer;
  offsets: number[];
  parity: { target: string; observer: string; frame: string }[];
  framePairs: string[][];
  defaultTime: string;
  kernels: string[];
}

interface ParityRow {
  scenario: string;
  call: string;
  detail: string;
  correction: Correction | null;
  epochs: number;
  maxRelDelta: number;
  pass: boolean;
}

interface PipelineRow {
  scenario: string;
  body: string;
  center: string;
  correction: 'NONE';
  frame: 'ECLIPJ2000';
  epochs: number;
  maxPosErrM: number;
  pointErrArcsec: number | null;
  posWithinTripwire: boolean;
  pointWithinTripwire: boolean | null;
}

// ── the harness ──────────────────────────────────────────────────────────────

describe('seam differential harness (M-0002)', () => {
  let gs1: ScenarioCtx;
  let gs2: ScenarioCtx;
  let oracle: SpiceBindings;
  let toolkit: { cosmolabe: string; cspiceWasm: string };

  beforeAll(async () => {
    const gs2Scene = await buildScene('saturn-soi');
    const gs1Scene = await buildUniverseFromCatalog({
      catalog: GS1_CATALOG,
      kernels: GS1_KERNELS,
      defaultTime: GS1_TIME,
    });
    gs2 = {
      scenario: 'GS-2',
      scene: gs2Scene,
      frames: await buildFramesLayer(GS2.kernels),
      offsets: GS2_OFFSETS_S,
      parity: GS2_PARITY,
      framePairs: GS2_FRAME_PAIRS,
      defaultTime: GS2.defaultTime,
      kernels: GS2.kernels,
    };
    gs1 = {
      scenario: 'GS-1',
      scene: gs1Scene,
      frames: await buildFramesLayer(GS1_KERNELS),
      offsets: GS1_OFFSETS_S,
      parity: GS1_PARITY,
      framePairs: GS1_FRAME_PAIRS,
      defaultTime: GS1_TIME,
      kernels: GS1_KERNELS,
    };

    // Toolkit provenance for the delta tables: both wrappers name the CSPICE
    // build they marshal into. The oracle instance is shared with the pipeline
    // pole conversion below (q2m); each WASM instance reserves real memory.
    oracle = await createSpiceBindings();
    let cosmolabeToolkit = 'unknown';
    try {
      const mod = (
        gs2Scene.spice as unknown as {
          module: { ccall: (...a: unknown[]) => unknown; UTF8ToString: (p: number) => string };
        }
      ).module;
      const ptr = mod.ccall('tkvrsn_c', 'number', ['string'], ['TOOLKIT']) as number;
      cosmolabeToolkit = mod.UTF8ToString(ptr);
    } catch {
      // Provenance only; the deltas below are the evidence.
    }
    toolkit = { cosmolabe: cosmolabeToolkit, cspiceWasm: oracle.tkvrsn() };
  });

  test('call-parity: identical CSPICE invocations agree to relative 1e-12', async () => {
    const rows: ParityRow[] = [];

    for (const ctx of [gs1, gs2]) {
      const { spice, et } = ctx.scene;
      const epochs = ctx.offsets.map((s) => et + s);

      // str2et vs toEt: the epoch conversion authority against the heritage parser.
      const relEt = Math.abs(ctx.frames.toEt(ctx.defaultTime) - spice!.str2et(ctx.defaultTime)) / Math.abs(et);
      rows.push({
        scenario: ctx.scenario,
        call: 'str2et',
        detail: ctx.defaultTime,
        correction: null,
        epochs: 1,
        maxRelDelta: relEt,
        pass: relEt <= GATE_REL,
      });

      // spkezr through both wrappers, every correction of the contract.
      for (const p of ctx.parity) {
        for (const correction of CORRECTIONS) {
          const batch = await ctx.frames.states({
            targets: [p.target],
            observer: p.observer,
            frame: p.frame,
            correction,
            epochs,
          });
          let maxRel = 0;
          for (let i = 0; i < epochs.length; i++) {
            const ref = spice!.spkezr(p.target, epochs[i]!, p.frame, correction, p.observer);
            const base = i * 6;
            const relPos = relVec(
              [batch.states[base]!, batch.states[base + 1]!, batch.states[base + 2]!],
              [ref.state[0]!, ref.state[1]!, ref.state[2]!],
            );
            const relVel = relVec(
              [batch.states[base + 3]!, batch.states[base + 4]!, batch.states[base + 5]!],
              [ref.state[3]!, ref.state[4]!, ref.state[5]!],
            );
            const relLt =
              correction === 'NONE'
                ? 0 // light time is not part of a geometric state comparison
                : Math.abs(batch.lightTimes[i]! - ref.lightTime) / ref.lightTime;
            maxRel = Math.max(maxRel, relPos, relVel, relLt);
          }
          rows.push({
            scenario: ctx.scenario,
            call: 'spkezr',
            detail: `${p.target} wrt ${p.observer} @ ${p.frame}`,
            correction,
            epochs: epochs.length,
            maxRelDelta: maxRel,
            pass: maxRel <= GATE_REL,
          });
        }
      }

      // pxform through both wrappers; chain().rotation is the frames tier's
      // direct pxform. Matrix elements are unit scale, so the max elementwise
      // delta reads as a relative delta against the gate.
      for (const [from, to] of ctx.framePairs) {
        let maxRel = 0;
        for (const t of epochs) {
          const ours = ctx.frames.chain(from!, to!, t).rotation;
          const ref = spice!.pxform(from!, to!, t);
          for (let k = 0; k < 9; k++) maxRel = Math.max(maxRel, Math.abs(ours[k]! - ref[k]!));
        }
        rows.push({
          scenario: ctx.scenario,
          call: 'pxform',
          detail: `${from} -> ${to}`,
          correction: null,
          epochs: epochs.length,
          maxRelDelta: maxRel,
          pass: maxRel <= GATE_REL,
        });
      }
    }

    const allPass = rows.every((r) => r.pass);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'seam-call-parity.json'),
      JSON.stringify(
        {
          description:
            'Differential harness, call-parity mode (M-0002): identical CSPICE invocations through both wrappers, cosmolabe @cosmolabe/spice (timecraftjs) as reference vs the frames tier over cspice-wasm, identical kernel bytes, gate relative 1e-12. maxRelDelta is the worst epoch: vector-norm relative for spkezr position and velocity (plus relative light time under corrections), relative for str2et, max elementwise (unit scale) for pxform.',
          gateRelative: GATE_REL,
          toolkit,
          scenarios: {
            'GS-1': {
              fixture: 'Cassini cruise, 010420R_SCPSE_EP1_JP83.bsp',
              epoch: GS1_TIME,
              sweep: 'epoch -30d..+30d (5 samples)',
              kernels: GS1_KERNELS,
              kernelSetHash: gs1.frames.kernels().setHash,
            },
            'GS-2': {
              fixture: 'saturn-soi harness scene, SOI SCPSE kernel',
              epoch: GS2.defaultTime,
              sweep: 'epoch -12h..+12h (5 samples)',
              kernels: GS2.kernels,
              kernelSetHash: gs2.frames.kernels().setHash,
            },
          },
          rows: rows.map((r) => ({ ...r, maxRelDelta: round(r.maxRelDelta) })),
          allPass,
        },
        null,
        2,
      ) + '\n',
    );

    // The gate (iron rule 3): call-parity red fails the rig and pnpm verify.
    for (const r of rows) {
      expect
        .soft(r.maxRelDelta, `${r.scenario} ${r.call} ${r.detail} corr=${r.correction}`)
        .toBeLessThanOrEqual(GATE_REL);
    }
    expect(allPass).toBe(true);
  });

  test('pipeline: each path through its own machinery, measured against the tripwires', async () => {
    const rows: PipelineRow[] = [];

    const measure = async (
      ctx: ScenarioCtx,
      bodies: { name: string; spiceName: string; spiceCenter: string; hasPole?: boolean }[],
    ) => {
      const { universe, et } = ctx.scene;
      for (const ob of bodies) {
        const body = universe.getBody(ob.name)!;
        let maxPosErrM = 0;
        for (const s of ctx.offsets) {
          const t = et + s;
          const ours = universe.absolutePositionOf(ob.name, t);
          const parent = universe.absolutePositionOf(body.parentName!, t);
          const batch = await ctx.frames.states({
            targets: [ob.spiceName],
            observer: ob.spiceCenter,
            frame: 'ECLIPJ2000',
            correction: 'NONE',
            epochs: [t],
          });
          const dx = ours[0]! - parent[0]! - batch.states[0]!;
          const dy = ours[1]! - parent[1]! - batch.states[1]!;
          const dz = ours[2]! - parent[2]! - batch.states[2]!;
          maxPosErrM = Math.max(maxPosErrM, norm(dx, dy, dz) * 1000);
        }

        // Pointing: the cosmolabe composed body-to-world pole vs the frames
        // tier's orientation quaternion (converted through SPICE's own q2m),
        // both expressed in ECLIPJ2000.
        let pointErrArcsec: number | null = null;
        if (ob.hasPole) {
          const q = body.rotationAt(et)!;
          const bw = composeBodyToWorldQuat(q, body.rotation!.sourceFrame);
          const poleOurs = rotateVecByQuat([0, 0, 1], bw);
          const quatBatch = await ctx.frames.orientation(ob.spiceName, 'ECLIPJ2000', [et]);
          const m = oracle.q2m([
            quatBatch.quats[0]!,
            quatBatch.quats[1]!,
            quatBatch.quats[2]!,
            quatBatch.quats[3]!,
          ]);
          pointErrArcsec = angleArcsec(poleOurs, [m[6]!, m[7]!, m[8]!]);
        }

        rows.push({
          scenario: ctx.scenario,
          body: ob.name,
          center: ob.spiceCenter,
          correction: 'NONE',
          frame: 'ECLIPJ2000',
          epochs: ctx.offsets.length,
          maxPosErrM: round(maxPosErrM),
          pointErrArcsec: pointErrArcsec === null ? null : round(pointErrArcsec),
          posWithinTripwire: maxPosErrM <= TRIP_POS_M,
          pointWithinTripwire: pointErrArcsec === null ? null : pointErrArcsec <= TRIP_POINT_ARCSEC,
        });
        expect(Number.isFinite(maxPosErrM)).toBe(true);
      }
    };

    await measure(gs1, [{ name: 'Cassini', spiceName: 'CASSINI', spiceCenter: 'SUN' }]);
    await measure(gs2, GS2.oracleBodies);

    const allWithin = rows.every(
      (r) => r.posWithinTripwire && (r.pointWithinTripwire ?? true),
    );
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'seam-pipeline.json'),
      JSON.stringify(
        {
          description:
            'Differential harness, pipeline mode (M-0002): cosmolabe through its own pipeline (Universe, CatalogLoader, trajectory caching and interpolation; per-leg relative absolutePositionOf, composed rotation pole) vs the frames tier over cspice-wasm (cache-free), identical kernel bytes, ECLIPJ2000, correction NONE. Tripwires 1 m position, 5 arcsec pointing; recorded, not asserted: green is required before any re-point merges (Session 3 goal), and this table is that record. GS-1 carries no pointing row: the cruise fixture has no rotating oracle body; pointing is exercised on GS-2. Named finding, first caught by this table: the GS-1 position row sits outside the 1 m tripwire because the heritage EclipticJ2000 conversion uses a truncated J2000 obliquity (23.4392911 deg, kinematics.ts) where SPICE ECLIPJ2000 uses 84381.448 arcsec; the 1.94e-10 rad difference is sub-millimeter at GS-2 planetocentric scale and 87 to 95 m at the GS-1 heliocentric 5.6 AU scale. Attribution is exact: rotating the SPICE truth by the constant difference collapses the residual to about 0.1 mm at every sweep epoch. The fix belongs to the Session 4 re-point (frames owns frame semantics), not to a heritage edit in this session (iron rule 2).',
          tripwires: { positionM: TRIP_POS_M, pointingArcsec: TRIP_POINT_ARCSEC },
          toolkit,
          scenarios: {
            'GS-1': { epoch: GS1_TIME, sweep: 'epoch -30d..+30d (5 samples)', kernelSetHash: gs1.frames.kernels().setHash },
            'GS-2': { epoch: GS2.defaultTime, sweep: 'epoch -12h..+12h (5 samples)', kernelSetHash: gs2.frames.kernels().setHash },
          },
          rows,
          allWithinTripwires: allWithin,
        },
        null,
        2,
      ) + '\n',
    );
  });
});
