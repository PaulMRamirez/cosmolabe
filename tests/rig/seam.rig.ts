/**
 * Differential harness: the seam gate of ADR M-0002 (iron rule 3). Both SPICE
 * paths, cosmolabe's timecraftjs-based @cosmolabe/spice and the cspice-wasm
 * layer behind the @cosmolabe/frames contracts, are driven over the four
 * golden scenarios with identical kernel bytes: GS-1 (heliocentric cruise,
 * Session 3), GS-2 (Cassini at Saturn, the saturn-soi scene, Session 3),
 * GS-3 (lunar south pole surface site with a topocentric TK frame, Session 4),
 * and GS-4 (a six-plane Walker LEO constellation written as Type 13 SPKs
 * through cspice-wasm and furnished byte-identically to both stacks,
 * Session 4).
 *
 * Two modes, tolerances ratified in M-0002:
 *
 * Call-parity: identical CSPICE invocations through both wrappers (str2et vs
 * toEt, spkezr vs StateProvider.states, pxform vs FramesService.chain) must
 * agree to relative 1e-12. This mode asserts; a breach fails the rig and
 * therefore `pnpm verify`.
 *
 * Pipeline: each path through its own machinery (cosmolabe through Universe,
 * CatalogLoader, trajectory caching and interpolation via absolutePositionOf
 * and the composed rotation quaternions; the new layer through the frames
 * tier, which is deliberately cache-free). Deltas are measured against the
 * 1 m position and 5 arcsec pointing tripwires. The tables carry
 * within-tripwire flags; scripts/seam.mjs --strict-pipeline turns them into
 * the merge gate (the re-point mode).
 *
 * Emits docs/validation/data/seam-call-parity.json and seam-pipeline.json.
 * Driven by scripts/seam.mjs under the pinned environment.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCENES, buildScene } from '../../cosmolabe/packages/core/src/__tests__/_harness/scenes.js';
import {
  buildUniverseFromCatalog,
  type BuiltScene,
} from '../../cosmolabe/packages/core/src/__tests__/_harness/buildUniverse.js';
import {
  furnishKernels,
  readKernelBuffer,
} from '../../cosmolabe/packages/core/src/__tests__/_harness/kernels.js';
import {
  composeBodyToWorldQuat,
  rotateVecByQuat,
} from '../../cosmolabe/packages/core/src/kinematics.js';
import type { CatalogJson } from '../../cosmolabe/packages/core/src/catalog/CatalogLoader.js';
import { Universe } from '../../cosmolabe/packages/core/src/Universe.js';
import { Spice } from '../../cosmolabe/packages/spice/src/index.js';
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
const ALL_CORRECTIONS: readonly Correction[] = ['NONE', 'LT', 'LT+S', 'CN', 'CN+S'];

// ── scenario fixture data ────────────────────────────────────────────────────

interface ParityPair {
  target: string;
  observer: string;
  frame: string;
  /** Defaults to all five contract corrections. */
  corrections?: readonly Correction[];
}

interface PipelineBody {
  name: string;
  spiceName?: string;
  spiceCenter: string;
  hasPole?: boolean;
  /** A surface site: a constant body-fixed vector (km) in `frame`, placed on
   *  the body named by spiceCenter. Compared through chain() instead of
   *  states(), since a site is not a SPICE ephemeris body. */
  bodyFixed?: { frame: string; vec: readonly [number, number, number] };
}

// GS-2 is the saturn-soi harness scene and its SOI kernel, unchanged.
const GS2 = SCENES['saturn-soi'];
const GS2_OFFSETS_S = [-12, -6, 0, 6, 12].map((h) => h * 3600);
const GS2_PARITY: ParityPair[] = [
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
// a month either side of a quiet mid-cruise epoch.
const GS1_TIME = '2000-06-01T00:00:00';
const GS1_KERNELS = ['naif0012.tls', 'pck00010.tpc', 'cassini/010420R_SCPSE_EP1_JP83.bsp'];
const GS1_OFFSETS_S = [-30, -15, 0, 15, 30].map((d) => d * 86400);
const GS1_PARITY: ParityPair[] = [
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

// GS-3: lunar south pole surface site (Session 4). The lunar kernels it needs
// are already in the fetch manifest: naif0012.tls, pck00010.tpc (IAU_MOON),
// and de425s.bsp (Sun, Earth, Moon, 1964 to 2050). The topocentric site frame
// is a fixture-authored TK (class 4) frame over IAU_MOON, furnished as
// identical bytes to both wrappers; per the Session 4 goal the J2000 pivot of
// FrameChain suffices to inspect it (single constant hop, checkable once).
const GS3_TIME = '2004-07-01T00:00:00';
const GS3_KERNELS = ['naif0012.tls', 'pck00010.tpc', 'de425s.bsp'];
const GS3_OFFSETS_S = [-14, -7, 0, 7, 14].map((d) => d * 86400);
const GS3_SITE_FRAME = 'SEAM_GS3_SITE';
const GS3_SITE_LAT_DEG = -89.9;
const GS3_SITE_LON_DEG = 0;
const GS3_MOON_RADIUS_KM = 1737.4;
// SPICE topocentric convention: AXES (3,2,3), ANGLES (-lon, lat-90, 180),
// z up (zenith), x north, y west at the site.
const GS3_SITE_FK = `\\begindata
FRAME_${GS3_SITE_FRAME}     = 1400001
FRAME_1400001_NAME       = '${GS3_SITE_FRAME}'
FRAME_1400001_CLASS      = 4
FRAME_1400001_CLASS_ID   = 1400001
FRAME_1400001_CENTER     = 301
TKFRAME_1400001_SPEC     = 'ANGLES'
TKFRAME_1400001_RELATIVE = 'IAU_MOON'
TKFRAME_1400001_ANGLES   = ( ${-GS3_SITE_LON_DEG}, ${GS3_SITE_LAT_DEG - 90}, 180.0 )
TKFRAME_1400001_AXES     = ( 3, 2, 3 )
TKFRAME_1400001_UNITS    = 'DEGREES'
\\begintext
`;
const GS3_SITE_VEC: readonly [number, number, number] = (() => {
  const lat = (GS3_SITE_LAT_DEG * Math.PI) / 180;
  const lon = (GS3_SITE_LON_DEG * Math.PI) / 180;
  return [
    GS3_MOON_RADIUS_KM * Math.cos(lat) * Math.cos(lon),
    GS3_MOON_RADIUS_KM * Math.cos(lat) * Math.sin(lon),
    GS3_MOON_RADIUS_KM * Math.sin(lat),
  ];
})();
const GS3_PARITY: ParityPair[] = [
  { target: 'MOON', observer: 'EARTH', frame: 'J2000' },
  { target: 'SUN', observer: 'MOON', frame: 'ECLIPJ2000' },
  // Sun geometry through the topocentric frame itself: state in the site
  // frame is the sun-elevation primitive, driven under every correction.
  { target: 'SUN', observer: 'MOON', frame: GS3_SITE_FRAME },
];
const GS3_FRAME_PAIRS = [
  ['J2000', 'IAU_MOON'],
  ['ECLIPJ2000', 'IAU_MOON'],
  ['IAU_MOON', GS3_SITE_FRAME],
  ['ECLIPJ2000', GS3_SITE_FRAME],
];
const GS3_CATALOG: CatalogJson = {
  name: 'GS-3 lunar south pole site (seam fixture)',
  defaultTime: GS3_TIME,
  items: [
    {
      name: 'Sun',
      class: 'star',
      trajectory: { type: 'FixedPoint', position: [0, 0, 0] },
      geometry: { type: 'Globe', radius: 695000 },
    },
    {
      name: 'Earth',
      class: 'planet',
      center: 'Sun',
      trajectoryFrame: 'J2000',
      trajectory: { type: 'Builtin', name: 'Earth' },
      geometry: { type: 'Globe', radius: 6378.14 },
      items: [
        {
          name: 'Moon',
          class: 'moon',
          center: 'Earth',
          trajectoryFrame: 'J2000',
          trajectory: { type: 'Builtin', name: 'Moon' },
          rotationModel: { type: 'Spice', bodyFrame: 'IAU_MOON' },
          geometry: { type: 'Globe', radius: GS3_MOON_RADIUS_KM },
          items: [
            {
              name: 'Site',
              class: 'other',
              center: 'Moon',
              trajectory: {
                type: 'FixedSpherical',
                latitude: GS3_SITE_LAT_DEG,
                longitude: GS3_SITE_LON_DEG,
                radius: GS3_MOON_RADIUS_KM,
              },
            },
          ],
        },
      ],
    },
  ],
} as CatalogJson;
const GS3_PIPELINE: PipelineBody[] = [
  { name: 'Earth', spiceName: 'EARTH', spiceCenter: 'SUN' },
  { name: 'Moon', spiceName: 'MOON', spiceCenter: 'EARTH', hasPole: true },
  { name: 'Site', spiceCenter: 'MOON', bodyFixed: { frame: 'IAU_MOON', vec: GS3_SITE_VEC } },
];

// GS-4: a six-plane Walker constellation in LEO (Session 4). The ephemerides
// are generated in the rig (circular two-body states, one satellite per
// plane), written as Type 13 Hermite SPK segments through cspice-wasm's
// writeSpkType13, read back with readKernelBytes, and furnished as identical
// bytes to both stacks: no external kernel exists for this scenario.
const GS4_TIME = '2004-07-01T00:00:00';
const GS4_KERNELS = ['naif0012.tls', 'pck00010.tpc', 'de425s.bsp'];
const GS4_OFFSETS_S = [-45, -22.5, 0, 22.5, 45].map((m) => m * 60);
const GS4_PLANES = 6;
const GS4_MU_EARTH = 398600.4418; // km^3/s^2
const GS4_SMA_KM = 6928.137; // 550 km circular
const GS4_INC_RAD = (53 * Math.PI) / 180;
const GS4_BODY_BASE = -9000; // synthetic NAIF ids -9000 .. -9005
const GS4_SAMPLE_STEP_S = 60;
const GS4_SAMPLE_SPAN_S = 3900; // covers the sweep with margin
const GS4_SAT = (k: number): string => String(GS4_BODY_BASE - k);

/** Circular two-body J2000 state for plane k at epoch offset dt from et0. */
function gs4State(k: number, dt: number): [number, number, number, number, number, number] {
  const raan = (k * (360 / GS4_PLANES) * Math.PI) / 180;
  const u0 = (k * 30 * Math.PI) / 180; // Walker phasing between planes
  const n = Math.sqrt(GS4_MU_EARTH / (GS4_SMA_KM * GS4_SMA_KM * GS4_SMA_KM));
  const u = u0 + n * dt;
  // Orbital-plane position/velocity, then Rz(raan) * Rx(inc).
  const rp = [GS4_SMA_KM * Math.cos(u), GS4_SMA_KM * Math.sin(u), 0];
  const vp = [-GS4_SMA_KM * n * Math.sin(u), GS4_SMA_KM * n * Math.cos(u), 0];
  const rot = (p: number[]): [number, number, number] => {
    const x1 = p[0]!;
    const y1 = p[1]! * Math.cos(GS4_INC_RAD) - p[2]! * Math.sin(GS4_INC_RAD);
    const z1 = p[1]! * Math.sin(GS4_INC_RAD) + p[2]! * Math.cos(GS4_INC_RAD);
    return [
      x1 * Math.cos(raan) - y1 * Math.sin(raan),
      x1 * Math.sin(raan) + y1 * Math.cos(raan),
      z1,
    ];
  };
  const r = rot(rp);
  const v = rot(vp);
  return [r[0], r[1], r[2], v[0], v[1], v[2]];
}

/** Generate the six Walker SPKs through cspice-wasm; return name plus bytes. */
function generateWalkerSpks(
  generator: SpiceBindings,
  et0: number,
): { name: string; bytes: Uint8Array }[] {
  const nSamples = Math.floor((2 * GS4_SAMPLE_SPAN_S) / GS4_SAMPLE_STEP_S) + 1;
  const epochs = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) epochs[i] = et0 - GS4_SAMPLE_SPAN_S + i * GS4_SAMPLE_STEP_S;
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (let k = 0; k < GS4_PLANES; k++) {
    const states = new Float64Array(nSamples * 6);
    for (let i = 0; i < nSamples; i++) {
      const s = gs4State(k, epochs[i]! - et0);
      for (let j = 0; j < 6; j++) states[i * 6 + j] = s[j]!;
    }
    const name = `seam-gs4-sat${k}.bsp`;
    generator.writeSpkType13(name, GS4_BODY_BASE - k, 399, 'J2000', `SEAM_GS4_${k}`, 7, epochs, states);
    out.push({ name, bytes: generator.readKernelBytes(name) });
  }
  return out;
}

const GS4_PARITY: ParityPair[] = [
  // Many-body update stress: every satellite through both wrappers,
  // geometric; one satellite additionally under every contract correction.
  ...Array.from({ length: GS4_PLANES }, (_, k) => ({
    target: GS4_SAT(k),
    observer: 'EARTH',
    frame: 'J2000',
    corrections: ['NONE'] as const,
  })),
  { target: GS4_SAT(0), observer: 'EARTH', frame: 'ECLIPJ2000' },
];
const GS4_FRAME_PAIRS = [
  ['J2000', 'IAU_EARTH'], // the ground-track frame
  ['ECLIPJ2000', 'J2000'],
];
const GS4_CATALOG: CatalogJson = {
  name: 'GS-4 six-plane Walker LEO constellation (seam fixture)',
  defaultTime: GS4_TIME,
  items: [
    {
      name: 'Sun',
      class: 'star',
      trajectory: { type: 'FixedPoint', position: [0, 0, 0] },
      geometry: { type: 'Globe', radius: 695000 },
    },
    {
      name: 'Earth',
      class: 'planet',
      center: 'Sun',
      trajectoryFrame: 'J2000',
      trajectory: { type: 'Builtin', name: 'Earth' },
      rotationModel: { type: 'Spice', bodyFrame: 'IAU_EARTH' },
      geometry: { type: 'Globe', radius: 6378.14 },
      items: Array.from({ length: GS4_PLANES }, (_, k) => ({
        name: `Walker-${k}`,
        class: 'spacecraft',
        center: 'Earth',
        trajectoryFrame: 'J2000',
        trajectory: { type: 'Spice', target: GS4_SAT(k), center: 'EARTH' },
      })),
    },
  ],
} as CatalogJson;
const GS4_PIPELINE: PipelineBody[] = [
  { name: 'Earth', spiceName: 'EARTH', spiceCenter: 'SUN', hasPole: true },
  ...Array.from({ length: GS4_PLANES }, (_, k) => ({
    name: `Walker-${k}`,
    spiceName: GS4_SAT(k),
    spiceCenter: 'EARTH',
  })),
];

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

interface ExtraKernel {
  name: string;
  bytes: Uint8Array;
}

async function buildFramesLayer(kernels: string[], extras: ExtraKernel[] = []): Promise<FramesLayer> {
  const frames = await createFramesLayer();
  for (const rel of kernels) {
    frames.furnish(rel.split('/').pop()!, new Uint8Array(readKernelBuffer(rel)));
  }
  for (const e of extras) frames.furnish(e.name, e.bytes);
  return frames;
}

/**
 * Rig-local scene builder: identical to the heritage
 * buildUniverseFromCatalog, plus extra in-memory kernels (the authored GS-3
 * site FK, the generated GS-4 SPKs) furnished before the catalog loads. Kept
 * here so the heritage harness stays untouched (iron rule 2).
 */
/** The timecraftjs reference instance for call-parity, same kernel bytes. */
async function buildTimecraftRef(kernels: string[], extras: ExtraKernel[] = []): Promise<Spice> {
  const ref = await Spice.init();
  await furnishKernels(ref, kernels);
  for (const e of extras) {
    const buf = e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength);
    await ref.furnish({ type: 'buffer', data: buf as ArrayBuffer, filename: e.name });
  }
  return ref;
}

async function buildSceneWithExtras(
  catalog: CatalogJson,
  kernels: string[],
  extras: ExtraKernel[],
  defaultTime: string,
): Promise<BuiltScene> {
  const spice = await Spice.init();
  await furnishKernels(spice, kernels);
  for (const e of extras) {
    const buf = e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength);
    await spice.furnish({ type: 'buffer', data: buf as ArrayBuffer, filename: e.name });
  }
  const et = spice.str2et(defaultTime);
  const universe = new Universe(spice);
  universe.loadCatalog(catalog);
  universe.setTime(et);
  return { universe, spice, et, bodyNames: universe.getAllBodies().map((b) => b.name) };
}

interface ScenarioCtx {
  scenario: string;
  scene: BuiltScene;
  /** The timecraftjs reference wrapper, rig-built: after the Session 4
   *  re-point the harness scenes run over the frames tier, so the rig
   *  constructs the heritage reference lane itself from the same bytes. */
  ref: Spice;
  frames: FramesLayer;
  offsets: number[];
  parity: ParityPair[];
  framePairs: string[][];
  defaultTime: string;
  kernels: string[];
  pipeline: PipelineBody[];
  fixture: string;
  sweep: string;
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
  let scenarios: ScenarioCtx[];
  let oracle: SpiceBindings;
  let toolkit: { cosmolabe: string; cspiceWasm: string };

  beforeAll(async () => {
    // Toolkit provenance plus the GS-4 generator: one shared cspice-wasm
    // instance (each WASM instance reserves real memory).
    oracle = await createSpiceBindings();
    oracle.furnsh('naif0012.tls', new Uint8Array(readKernelBuffer('naif0012.tls')));
    const gs4Et0 = oracle.str2et(GS4_TIME);
    const walkerSpks = generateWalkerSpks(oracle, gs4Et0);
    const gs3Fk: ExtraKernel = {
      name: 'seam-gs3-site.tf',
      bytes: new TextEncoder().encode(GS3_SITE_FK),
    };

    const gs2Scene = await buildScene('saturn-soi');
    const gs1Scene = await buildUniverseFromCatalog({
      catalog: GS1_CATALOG,
      kernels: GS1_KERNELS,
      defaultTime: GS1_TIME,
    });
    const gs3Scene = await buildSceneWithExtras(GS3_CATALOG, GS3_KERNELS, [gs3Fk], GS3_TIME);
    const gs4Scene = await buildSceneWithExtras(GS4_CATALOG, GS4_KERNELS, walkerSpks, GS4_TIME);

    scenarios = [
      {
        scenario: 'GS-1',
        scene: gs1Scene,
        ref: await buildTimecraftRef(GS1_KERNELS),
        frames: await buildFramesLayer(GS1_KERNELS),
        offsets: GS1_OFFSETS_S,
        parity: GS1_PARITY,
        framePairs: GS1_FRAME_PAIRS,
        defaultTime: GS1_TIME,
        kernels: GS1_KERNELS,
        pipeline: [{ name: 'Cassini', spiceName: 'CASSINI', spiceCenter: 'SUN' }],
        fixture: 'Cassini cruise, 010420R_SCPSE_EP1_JP83.bsp',
        sweep: 'epoch -30d..+30d (5 samples)',
      },
      {
        scenario: 'GS-2',
        scene: gs2Scene,
        ref: await buildTimecraftRef(GS2.kernels),
        frames: await buildFramesLayer(GS2.kernels),
        offsets: GS2_OFFSETS_S,
        parity: GS2_PARITY,
        framePairs: GS2_FRAME_PAIRS,
        defaultTime: GS2.defaultTime,
        kernels: GS2.kernels,
        pipeline: GS2.oracleBodies.map((ob) => ({
          name: ob.name,
          spiceName: ob.spiceName,
          spiceCenter: ob.spiceCenter,
          hasPole: ob.hasPole,
        })),
        fixture: 'saturn-soi harness scene, SOI SCPSE kernel',
        sweep: 'epoch -12h..+12h (5 samples)',
      },
      {
        scenario: 'GS-3',
        scene: gs3Scene,
        ref: await buildTimecraftRef(GS3_KERNELS, [gs3Fk]),
        frames: await buildFramesLayer(GS3_KERNELS, [gs3Fk]),
        offsets: GS3_OFFSETS_S,
        parity: GS3_PARITY,
        framePairs: GS3_FRAME_PAIRS,
        defaultTime: GS3_TIME,
        kernels: GS3_KERNELS,
        pipeline: GS3_PIPELINE,
        fixture:
          'lunar south pole site, authored TK frame over IAU_MOON, de425s ephemerides',
        sweep: 'epoch -14d..+14d (5 samples)',
      },
      {
        scenario: 'GS-4',
        scene: gs4Scene,
        ref: await buildTimecraftRef(GS4_KERNELS, walkerSpks),
        frames: await buildFramesLayer(GS4_KERNELS, walkerSpks),
        offsets: GS4_OFFSETS_S,
        parity: GS4_PARITY,
        framePairs: GS4_FRAME_PAIRS,
        defaultTime: GS4_TIME,
        kernels: GS4_KERNELS,
        pipeline: GS4_PIPELINE,
        fixture:
          'six-plane Walker LEO constellation, rig-generated Type 13 SPKs via writeSpkType13',
        sweep: 'epoch -45min..+45min (5 samples)',
      },
    ];

    let cosmolabeToolkit = 'unknown';
    try {
      const mod = (
        scenarios[1]!.ref as unknown as {
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

  const scenarioMeta = () =>
    Object.fromEntries(
      scenarios.map((ctx) => [
        ctx.scenario,
        {
          fixture: ctx.fixture,
          epoch: ctx.defaultTime,
          sweep: ctx.sweep,
          kernels: ctx.kernels,
          kernelSetHash: ctx.frames.kernels().setHash,
        },
      ]),
    );

  test('call-parity: identical CSPICE invocations agree to relative 1e-12', async () => {
    const rows: ParityRow[] = [];

    for (const ctx of scenarios) {
      const { et } = ctx.scene;
      const spice = ctx.ref;
      const epochs = ctx.offsets.map((s) => et + s);

      // str2et vs toEt: the epoch conversion authority against the heritage parser.
      const relEt =
        Math.abs(ctx.frames.toEt(ctx.defaultTime) - spice.str2et(ctx.defaultTime)) / Math.abs(et);
      rows.push({
        scenario: ctx.scenario,
        call: 'str2et',
        detail: ctx.defaultTime,
        correction: null,
        epochs: 1,
        maxRelDelta: relEt,
        pass: relEt <= GATE_REL,
      });

      // spkezr through both wrappers.
      for (const p of ctx.parity) {
        for (const correction of p.corrections ?? ALL_CORRECTIONS) {
          const batch = await ctx.frames.states({
            targets: [p.target],
            observer: p.observer,
            frame: p.frame,
            correction,
            epochs,
          });
          let maxRel = 0;
          for (let i = 0; i < epochs.length; i++) {
            const ref = spice.spkezr(p.target, epochs[i]!, p.frame, correction, p.observer);
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
          const ref = spice.pxform(from!, to!, t);
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
            'Differential harness, call-parity mode (M-0002): identical CSPICE invocations through both wrappers, cosmolabe @cosmolabe/spice (timecraftjs) as reference vs the frames tier over cspice-wasm, identical kernel bytes, gate relative 1e-12, all four golden scenarios. maxRelDelta is the worst epoch: vector-norm relative for spkezr position and velocity (plus relative light time under corrections), relative for str2et, max elementwise (unit scale) for pxform.',
          gateRelative: GATE_REL,
          toolkit,
          scenarios: scenarioMeta(),
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

    for (const ctx of scenarios) {
      const { universe, et } = ctx.scene;
      for (const ob of ctx.pipeline) {
        const body = universe.getBody(ob.name)!;
        let maxPosErrM = 0;
        for (const s of ctx.offsets) {
          const t = et + s;
          const ours = universe.absolutePositionOf(ob.name, t);
          const parent = universe.absolutePositionOf(body.parentName!, t);
          let theirs: readonly number[];
          if (ob.bodyFixed) {
            // A surface site: rotate the constant body-fixed vector into
            // ECLIPJ2000 through FramesService.chain (transpose of the
            // world-to-body-fixed rotation).
            const m = ctx.frames.chain('ECLIPJ2000', ob.bodyFixed.frame, t).rotation;
            const v = ob.bodyFixed.vec;
            theirs = [
              m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
              m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
              m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2],
            ];
          } else {
            const batch = await ctx.frames.states({
              targets: [ob.spiceName!],
              observer: ob.spiceCenter,
              frame: 'ECLIPJ2000',
              correction: 'NONE',
              epochs: [t],
            });
            theirs = [batch.states[0]!, batch.states[1]!, batch.states[2]!];
          }
          const dx = ours[0]! - parent[0]! - theirs[0]!;
          const dy = ours[1]! - parent[1]! - theirs[1]!;
          const dz = ours[2]! - parent[2]! - theirs[2]!;
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
          const quatBatch = await ctx.frames.orientation(ob.spiceName!, 'ECLIPJ2000', [et]);
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
    }

    const allWithin = rows.every((r) => r.posWithinTripwire && (r.pointWithinTripwire ?? true));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'seam-pipeline.json'),
      JSON.stringify(
        {
          description:
            'Differential harness, pipeline mode (M-0002): cosmolabe through its own pipeline (Universe, CatalogLoader, trajectory caching and interpolation; per-leg relative absolutePositionOf, composed rotation pole, body-fixed site placement; since the Session 4 re-point that pipeline runs over the frames tier through the heritage adapter) vs the frames tier direct (cache-free), identical kernel bytes, ECLIPJ2000, correction NONE, all four golden scenarios. Tripwires 1 m position, 5 arcsec pointing; scripts/seam.mjs --strict-pipeline is the re-point merge gate. GS-1 and GS-3 satellites of note: the Session 3 GS-1 tripwire breach (the truncated heritage obliquity, 87 to 95 m at 5.6 AU) closed when the Session 4 Class B fix landed; the GS-2 sub-meter rows of the Session 3 table were the same constant on the J2000-framed legs, and the post-fix table shows the true pipeline noise floor near 0.1 mm.',
          tripwires: { positionM: TRIP_POS_M, pointingArcsec: TRIP_POINT_ARCSEC },
          toolkit,
          scenarios: scenarioMeta(),
          rows,
          allWithinTripwires: allWithin,
        },
        null,
        2,
      ) + '\n',
    );
  });
});
