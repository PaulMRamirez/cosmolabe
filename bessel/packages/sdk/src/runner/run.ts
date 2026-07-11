// The single headless execution entry. Validates the job, opens a SPICE engine, resolves
// references, then executes operations in order against an injected RunIo (the PAL seam),
// writing artifacts and recording a per-op result. Operational failures are recorded and
// mapped to an exit code; only programmer error throws. (STK_PARITY_SPEC, SDK.)

import type { KernelHandle } from '@bessel/pal';
import { createSpiceEngine } from '@bessel/spice';
import { createMissionEnv } from '@bessel/propagator';
import { JobReferenceError, SdkError } from '../errors.ts';
import { validateJob } from '../job/validate.ts';
import type { BatchJob, EntityDecl, Operation } from '../job/types.ts';
import { BODY_GM } from './bodies.ts';
import type { OpContext, ResolvedDefaults, RunIo } from './context.ts';
import type { OpResult } from './results.ts';
import { buildManifest, type ProvenanceTape, type RunManifest } from './provenance.ts';
import { runFurnish } from '../ops/furnish.ts';
import { runPropagate } from '../ops/propagate.ts';
import { runRunMcs } from '../ops/run-mcs.ts';
import { runAnalyzeRange } from '../ops/analyze-range.ts';
import { runAnalyzeEclipse } from '../ops/analyze-eclipse.ts';
import { runAnalyzeAccess } from '../ops/analyze-access.ts';
import { runAnalyzeLinkBudget } from '../ops/analyze-link-budget.ts';
import { runLoadCatalog } from '../ops/load-catalog.ts';
import { runReport } from '../ops/report.ts';
import { runExportOem } from '../ops/export-oem.ts';
import { runExportCsv } from '../ops/export-csv.ts';

export type { RunIo } from './context.ts';
export type { RunManifest, KernelDigest, OutputDigest } from './manifest.ts';

export interface RunRequest {
  readonly job: BatchJob;
  readonly io: RunIo;
  readonly dryRun?: boolean;
  readonly signal?: AbortSignal;
}

export interface OpRecord {
  readonly index: number;
  readonly op: string;
  readonly id?: string;
  readonly status: 'ok' | 'failed' | 'skipped';
  readonly outputs: readonly string[];
  readonly error?: { readonly code: string; readonly message: string; readonly location?: string };
}

export interface RunResult {
  readonly status: 'ok' | 'failed' | 'completed-with-failures';
  readonly exitCode: 0 | 1 | 3;
  readonly ops: readonly OpRecord[];
  /** Provenance manifest: kernel digests, op statuses, output file hashes. */
  readonly manifest: RunManifest;
}

export interface RunSummary {
  readonly status: RunResult['status'];
  readonly ops: readonly OpRecord[];
}

const producerId = (op: Operation): string | undefined =>
  op.op === 'propagate' || op.op === 'runMcs' || op.op === 'analyze' || op.op === 'analyzeEclipse' || op.op === 'analyzeAccess' || op.op === 'analyzeLinkBudget'
    ? op.id
    : undefined;

const fileOf = (op: Operation): string | undefined =>
  op.op === 'exportOem' || op.op === 'exportCsv' || op.op === 'report' ? op.file : undefined;

/** Producer ids a `from`-style op references (export ops name one, report names many). */
const fromRefs = (op: Operation): readonly string[] =>
  op.op === 'exportOem' || op.op === 'exportCsv' ? [op.from] : op.op === 'report' ? op.from : [];

export async function runJob(req: RunRequest): Promise<RunResult> {
  const job = validateJob(req.job);
  const ops = job.operations;
  const producers = new Set<string>();
  for (const op of ops) {
    const id = producerId(op);
    if (id) producers.add(id);
  }
  // Reference pass: a `from` reference (export ops, report) must name a declared
  // producer; nothing executes yet.
  ops.forEach((op, i) => {
    for (const ref of fromRefs(op)) {
      if (!producers.has(ref)) throw new JobReferenceError(`operation references unknown producer "${ref}"`, `/operations/${i}/from`, ref);
    }
  });

  if (req.dryRun) {
    const records = ops.map<OpRecord>((op, i) => ({ index: i, op: op.op, id: producerId(op), status: 'skipped', outputs: [] }));
    return { status: 'ok', exitCode: 0, ops: records, manifest: await buildManifest(records, emptyTape()) };
  }

  const engine = await createSpiceEngine();
  try {
    return await execute(job, ops, engine, req.io, req.signal);
  } finally {
    await engine.kclear();
  }
}

function emptyTape(): ProvenanceTape {
  return { kernels: [], outputs: [] };
}

/** Wrap a RunIo so the runner records every kernel read and artifact write for the manifest. */
function tapeIo(io: RunIo, tape: ProvenanceTape): RunIo {
  const seenKernel = new Set<string>();
  return {
    kernels: {
      list: () => io.kernels.list(),
      resolve: (name: string) => io.kernels.resolve(name),
      async read(handle: KernelHandle): Promise<Uint8Array> {
        const bytes = await io.kernels.read(handle);
        if (!seenKernel.has(handle.name)) {
          seenKernel.add(handle.name);
          tape.kernels.push({ name: handle.name, bytes });
        }
        return bytes;
      },
    },
    async writeFile(relPath: string, data: Uint8Array): Promise<void> {
      await io.writeFile(relPath, data);
      tape.outputs.push({ path: relPath, bytes: data });
    },
    ...(io.readText ? { readText: (relPath: string) => io.readText!(relPath) } : {}),
  };
}

async function execute(
  job: BatchJob,
  ops: readonly Operation[],
  engine: Awaited<ReturnType<typeof createSpiceEngine>>,
  rawIo: RunIo,
  signal?: AbortSignal,
): Promise<RunResult> {
  const defaults: ResolvedDefaults = { frame: job.defaults?.frame ?? 'J2000', center: job.defaults?.center ?? 'EARTH' };
  const entities = new Map<string, EntityDecl>(Object.entries(job.entities ?? {}));
  const registry = new Map<string, OpResult>();
  const env = createMissionEnv(BODY_GM);
  const onError = job.output.onError ?? 'stop';
  const tape = emptyTape();
  const io = tapeIo(rawIo, tape);

  const records: OpRecord[] = [];
  let anyFailure = false;
  let stopped = false;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (stopped) {
      records.push({ index: i, op: op.op, id: producerId(op), status: 'skipped', outputs: [] });
      continue;
    }
    const ctx: OpContext = { engine, io, registry, entities, defaults, env, signal };
    try {
      const result = await dispatch(op, ctx);
      const id = producerId(op);
      if (id) registry.set(id, result);
      const outputs = fileOf(op);
      records.push({ index: i, op: op.op, id, status: 'ok', outputs: outputs ? [outputs] : [] });
    } catch (e) {
      anyFailure = true;
      records.push({ index: i, op: op.op, id: producerId(op), status: 'failed', outputs: [], error: errorInfo(e) });
      if (onError === 'stop') stopped = true;
    }
  }

  const manifest = await buildManifest(records, tape);
  if (stopped) return { status: 'failed', exitCode: 1, ops: records, manifest };
  if (anyFailure) return { status: 'completed-with-failures', exitCode: 3, ops: records, manifest };
  return { status: 'ok', exitCode: 0, ops: records, manifest };
}

function dispatch(op: Operation, ctx: OpContext): Promise<OpResult> {
  switch (op.op) {
    case 'furnish':
      return runFurnish(op, ctx);
    case 'propagate':
      return runPropagate(op, ctx);
    case 'runMcs':
      return runRunMcs(op, ctx);
    case 'analyze':
      return runAnalyzeRange(op, ctx);
    case 'analyzeEclipse':
      return runAnalyzeEclipse(op, ctx);
    case 'analyzeAccess':
      return runAnalyzeAccess(op, ctx);
    case 'analyzeLinkBudget':
      return runAnalyzeLinkBudget(op, ctx);
    case 'loadCatalog':
      return runLoadCatalog(op, ctx);
    case 'report':
      return runReport(op, ctx);
    case 'exportOem':
      return runExportOem(op, ctx);
    case 'exportCsv':
      return runExportCsv(op, ctx);
  }
}

function errorInfo(e: unknown): { code: string; message: string; location?: string } {
  if (e instanceof SdkError) return { code: e.code, message: e.message, location: e.location };
  if (e instanceof Error) return { code: e.name, message: e.message };
  return { code: 'unknown', message: String(e) };
}
