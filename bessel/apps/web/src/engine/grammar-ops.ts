// The M-0008 grammar demo operations: own the compute worker client, run the
// four jobs (one per product kind, GS-2 era plus the GS-4 Walker field),
// stream partials into the store and the scene, and map products onto the
// canonical forms. Lazy-imported by BesselEngine like analysis-ops, so none
// of this reaches the first-paint bundle. Pure product-to-spec mappers are
// exported for unit tests.

import type { AnalysisProduct, GeoLayer, ScalarField } from '@bessel/compute';
import type { CoverageOverlaySpec } from '@bessel/scene';
import type {
  AppStore,
  GrammarJobKind,
  GrammarJobStatus,
  GrammarJobView,
  GrammarProvenanceView,
} from '../store/app-state.ts';
import type { EngineCore } from './bootstrap.ts';
import {
  JobClient,
  JobClientCancelled,
  type JobRun,
  type JobSpec,
  type WireSpkPublication,
} from '@bessel/compute';
import cspiceWasmUrl from 'cspice-wasm/wasm/cspice.wasm?url';
import { KERNEL_ORDER, KERNEL_URLS } from '../kernels.ts';

// ── demo fixture constants (the GS-2 era carried by the boot kernels) ────────

const EPOCH = '2004-07-01T01:00:00';
const HOUR = 3600;
const GS4_PLANES = 6;
const GS4_BODY_BASE = -975000;
const GS4_SMA_KM = 6928.137;
const GS4_INC_RAD = (53 * Math.PI) / 180;
const EARTH_NAIF = 399;

export interface GrammarRef {
  client: JobClient | null;
  et0: number;
  runs: Map<GrammarJobKind, JobRun>;
}

export function createGrammarRef(): GrammarRef {
  return { client: null, et0: 0, runs: new Map() };
}

// ── pure product-to-form mappers (unit-tested) ───────────────────────────────

/** ScalarField to the scene's draped overlay spec. Unresolved (NaN) cells
 *  render as zero until their partial arrives; values are percent in [0,100]
 *  normalized to the overlay's [0,1] figure of merit. */
export function fieldToOverlaySpec(
  field: ScalarField,
  anchorBody: string,
  radiiKm: readonly number[],
): CoverageOverlaySpec {
  const cells = [];
  for (let r = 0; r < field.latCount; r++) {
    const latRad =
      field.latCount === 1
        ? (field.latMin + field.latMax) / 2
        : field.latMin + ((field.latMax - field.latMin) * r) / (field.latCount - 1);
    for (let c = 0; c < field.lonCount; c++) {
      const lonRad =
        field.lonCount === 1
          ? (field.lonMin + field.lonMax) / 2
          : field.lonMin + ((field.lonMax - field.lonMin) * c) / (field.lonCount - 1);
      const v = field.values[r * field.lonCount + c]!;
      cells.push({ latRad, lonRad, fom: Number.isFinite(v) ? Math.min(1, Math.max(0, v / 100)) : 0 });
    }
  }
  return {
    anchorBody,
    bodyRadiusKm: radiiKm[0] ?? 6378.14,
    polarRadiusKm: radiiKm[2] ?? radiiKm[0] ?? 6378.14,
    latCount: field.latCount,
    lonCount: field.lonCount,
    cells,
  };
}

/** Count of resolved (non-NaN) cells, for the legend chip. */
export function fieldResolvedCells(field: ScalarField): number {
  let n = 0;
  for (const v of field.values) if (Number.isFinite(v)) n++;
  return n;
}

/** GeoLayer polyline (body-fixed km) to scene points, rotated into the
 *  inertial world by a fixed rotation matrix (a snapshot at the demo epoch;
 *  the drape is labeled as such). */
export function layerToScenePoints(
  layer: GeoLayer,
  rotation: readonly number[],
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < layer.positions.length; i += 3) {
    const x = layer.positions[i]!;
    const y = layer.positions[i + 1]!;
    const z = layer.positions[i + 2]!;
    out.push([
      rotation[0]! * x + rotation[1]! * y + rotation[2]! * z,
      rotation[3]! * x + rotation[4]! * y + rotation[5]! * z,
      rotation[6]! * x + rotation[7]! * y + rotation[8]! * z,
    ]);
  }
  return out;
}

export function provenanceView(product: AnalysisProduct): GrammarProvenanceView {
  const p = product.provenance;
  return {
    engine: p.engine,
    version: p.version,
    setHash: p.kernels.setHash,
    frame: p.frame,
    correction: p.correction,
    computedAt: p.computedAt,
    jobId: p.jobId,
  };
}

// ── orchestration ────────────────────────────────────────────────────────────

function setJob(store: AppStore, kind: GrammarJobKind, patch: Partial<GrammarJobView>): void {
  store.setState((s) => ({
    grammar: {
      ...s.grammar,
      jobs: { ...s.grammar.jobs, [kind]: { ...s.grammar.jobs[kind], ...patch } },
    },
  }));
}

const MU_EARTH = 398600.4418; // km^3/s^2

/** Circular two-body J2000 states for the six-plane Walker set, as wire
 *  publications for the substrate (provenance-tracked in the worker). */
export function buildWalkerPublications(et0: number): WireSpkPublication[] {
  const spanS = 3 * HOUR;
  const stepS = 60;
  const n = Math.floor((2 * spanS) / stepS) + 1;
  const meanMotion = Math.sqrt(MU_EARTH / (GS4_SMA_KM * GS4_SMA_KM * GS4_SMA_KM));
  const out: WireSpkPublication[] = [];
  for (let k = 0; k < GS4_PLANES; k++) {
    const raan = (k * 2 * Math.PI) / GS4_PLANES;
    const u0 = (k * Math.PI) / 6;
    const epochs = new Float64Array(n);
    const states = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) {
      const et = et0 - spanS + i * stepS;
      epochs[i] = et;
      const u = u0 + meanMotion * (et - et0);
      const rp = [GS4_SMA_KM * Math.cos(u), GS4_SMA_KM * Math.sin(u), 0];
      const vp = [
        -GS4_SMA_KM * meanMotion * Math.sin(u),
        GS4_SMA_KM * meanMotion * Math.cos(u),
        0,
      ];
      const rot = (v: number[]): [number, number, number] => {
        const y1 = v[1]! * Math.cos(GS4_INC_RAD) - v[2]! * Math.sin(GS4_INC_RAD);
        const z1 = v[1]! * Math.sin(GS4_INC_RAD) + v[2]! * Math.cos(GS4_INC_RAD);
        return [
          v[0]! * Math.cos(raan) - y1 * Math.sin(raan),
          v[0]! * Math.sin(raan) + y1 * Math.cos(raan),
          z1,
        ];
      };
      const r = rot(rp);
      const v = rot(vp);
      states.set([r[0], r[1], r[2], v[0], v[1], v[2]], i * 6);
    }
    out.push({
      name: `grammar-walker-${k}.bsp`,
      body: GS4_BODY_BASE - k,
      center: EARTH_NAIF,
      frame: 'J2000',
      segid: `GRAMMAR_WALKER_${k}`,
      degree: 7,
      epochs,
      states,
    });
  }
  return out;
}

async function ensureClient(store: AppStore, ref: GrammarRef): Promise<JobClient> {
  if (ref.client) return ref.client;
  const kernels = await Promise.all(
    KERNEL_ORDER.map(async (name) => {
      const res = await fetch(KERNEL_URLS[name]!);
      if (!res.ok) throw new Error(`grammar demo: kernel fetch failed for ${name} (${res.status})`);
      return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
    }),
  );
  const worker = new Worker(new URL('../compute.worker.ts', import.meta.url), { type: 'module' });
  const client = new JobClient(worker, { kernels, epoch: EPOCH, wasmUrl: cspiceWasmUrl });
  const { et0 } = await client.ready;
  if (et0 === null) throw new Error('grammar demo: the substrate did not resolve the epoch');
  // Publish the Walker set post-ready (its epochs need et0) and take the
  // updated hash: provenance covers the synthetic ephemerides too.
  const kernelSetHash = await client.publish(buildWalkerPublications(et0));
  ref.client = client;
  ref.et0 = et0;
  store.setState((s) => ({ grammar: { ...s.grammar, kernelSetHash } }));
  return client;
}

function jobSpec(kind: GrammarJobKind, et0: number): JobSpec {
  switch (kind) {
    case 'gs2-access':
      return {
        kind: 'access',
        request: {
          observer: 'SATURN',
          targets: ['CASSINI', 'SUN'],
          span: [et0, et0 + 4 * HOUR],
          step: HOUR,
          constraints: [{ kind: 'range', maxKm: 2.0e5 }],
          correction: 'NONE',
        },
      };
    case 'gs2-series':
      return {
        kind: 'series',
        request: {
          providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI' }],
          span: [et0, et0 + 4 * HOUR],
          step: 60,
          frame: 'J2000',
          correction: 'NONE',
          chunks: 8,
        },
      };
    case 'gs2-track':
      return {
        kind: 'groundTrack',
        request: {
          body: 'SATURN',
          satellite: 'CASSINI',
          bodyFrame: 'IAU_SATURN',
          span: [et0, et0 + 4 * HOUR],
          step: 120,
          correction: 'NONE',
          chunks: 8,
        },
      };
    case 'gs4-access':
      return {
        kind: 'access',
        request: {
          observer: 'EARTH',
          targets: Array.from({ length: GS4_PLANES }, (_, k) => String(GS4_BODY_BASE - k)),
          span: [et0, et0 + 2 * HOUR],
          step: 60,
          constraints: [
            {
              kind: 'azElMask',
              facility: {
                body: 'EARTH',
                bodyFrame: 'IAU_EARTH',
                lonRad: (-100 * Math.PI) / 180,
                latRad: (40 * Math.PI) / 180,
                altKm: 0,
              },
              minElevationRad: (10 * Math.PI) / 180,
            },
          ],
          correction: 'NONE',
        },
      };
    case 'gs4-field':
      return {
        kind: 'coverage',
        request: {
          grid: {
            body: 'EARTH',
            bodyFrame: 'IAU_EARTH',
            latMin: (-66 * Math.PI) / 180,
            latMax: (66 * Math.PI) / 180,
            latCount: 12,
            lonMin: -Math.PI,
            lonMax: Math.PI * (1 - 2 / 24),
            lonCount: 24,
            altKm: 0,
          },
          assets: Array.from({ length: GS4_PLANES }, (_, k) => String(GS4_BODY_BASE - k)),
          span: [et0, et0 + 2 * HOUR],
          step: 600,
          minElevationRad: 0,
          correction: 'NONE',
        },
      };
  }
}

async function applyProduct(
  e: EngineCore,
  store: AppStore,
  kind: GrammarJobKind,
  et0: number,
  product: AnalysisProduct,
): Promise<void> {
  const p = product.product;
  if ((kind === 'gs2-access' || kind === 'gs4-access') && p.kind === 'intervals') {
    const span: readonly [number, number] =
      kind === 'gs2-access' ? [et0, et0 + 4 * HOUR] : [et0, et0 + 2 * HOUR];
    store.setState((s) => ({
      grammar: {
        ...s.grammar,
        intervals: { ...s.grammar.intervals, [kind]: { sets: p.sets, span } },
      },
    }));
  } else if (kind === 'gs2-series' && p.kind === 'series' && p.series[0]) {
    const first = p.series[0];
    store.setState((s) => ({ grammar: { ...s.grammar, series: first } }));
  } else if (kind === 'gs2-track' && p.kind === 'geometry' && p.layers[0]) {
    const rotation = await e.spice.pxform('IAU_SATURN', 'J2000', et0);
    const points = layerToScenePoints(p.layers[0], rotation);
    e.scene.setOrbits([{ id: 'grammar-track', anchorBody: 'Saturn', points, color: 0x67e8f9 }]);
    store.setState((s) => ({ grammar: { ...s.grammar, trackPoints: points.length } }));
  } else if (kind === 'gs4-field' && p.kind === 'field') {
    const radii = await e.spice.bodvrd('EARTH', 'RADII');
    e.scene.setCoverageOverlay(fieldToOverlaySpec(p.field, 'Earth', radii));
    store.setState((s) => ({
      grammar: {
        ...s.grammar,
        fieldCellsResolved: fieldResolvedCells(p.field),
        fieldCellsTotal: p.field.values.length,
      },
    }));
  }
}

/** Run one grammar job: stream partials into the store and the scene, stamp
 *  the provenance view from the first partial, and record the terminal state
 *  (done, cancelled, or the error) honestly. */
export async function runGrammarJob(
  e: EngineCore,
  store: AppStore,
  ref: GrammarRef,
  kind: GrammarJobKind,
): Promise<void> {
  const client = await ensureClient(store, ref);
  setJob(store, kind, { status: 'running', pct: 0, partials: 0, provenance: null });
  const run = client.run(jobSpec(kind, ref.et0), (event) => {
    const partial = event.partial;
    const patch: Partial<GrammarJobView> = partial
      ? {
          pct: event.pct,
          partials: store.getState().grammar.jobs[kind].partials + 1,
          provenance: provenanceView(partial),
        }
      : { pct: event.pct };
    if (partial) void applyProduct(e, store, kind, ref.et0, partial);
    setJob(store, kind, patch);
  });
  ref.runs.set(kind, run);
  try {
    const product = await run.result;
    await applyProduct(e, store, kind, ref.et0, product);
    setJob(store, kind, { status: 'done', pct: 100, provenance: provenanceView(product) });
  } catch (err) {
    if (err instanceof JobClientCancelled) {
      setJob(store, kind, { status: 'cancelled' });
    } else {
      const status: GrammarJobStatus = { error: err instanceof Error ? err.message : String(err) };
      setJob(store, kind, { status });
      throw err;
    }
  } finally {
    ref.runs.delete(kind);
  }
}

export function cancelGrammarJob(ref: GrammarRef, kind: GrammarJobKind): void {
  ref.runs.get(kind)?.cancel();
}

export function disposeGrammar(ref: GrammarRef): void {
  ref.client?.dispose();
  ref.client = null;
  ref.runs.clear();
}
