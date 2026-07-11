// Hand-written structural validation of a batch job: the source of truth, never relaxed
// to let a job pass. Every failure is a JobSchemaError with a JSON pointer to the exact
// offending node, so an authoring mistake is located, not guessed. (STK_PARITY_SPEC, SDK.)

import { JobSchemaError, UnsupportedJobVersionError } from '../errors.ts';
import type { BatchJob, EntityDecl, GridSpec, Operation } from './types.ts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function assertObject(v: unknown, ptr: string): Record<string, unknown> {
  if (!isObject(v)) throw new JobSchemaError(`expected an object at ${ptr}`, ptr);
  return v;
}
function assertString(v: unknown, ptr: string): string {
  if (typeof v !== 'string') throw new JobSchemaError(`expected a string at ${ptr}`, ptr);
  return v;
}
function assertNumber(v: unknown, ptr: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new JobSchemaError(`expected a finite number at ${ptr}`, ptr);
  return v;
}
function assertArray(v: unknown, ptr: string): unknown[] {
  if (!Array.isArray(v)) throw new JobSchemaError(`expected an array at ${ptr}`, ptr);
  return v;
}

function validateGrid(v: unknown, ptr: string): void {
  const g = assertObject(v, ptr) as Partial<GridSpec> & Record<string, unknown>;
  if ('epochs' in g) {
    const ep = assertArray(g.epochs, `${ptr}/epochs`);
    if (ep.length === 0) throw new JobSchemaError('grid epochs must be non-empty', `${ptr}/epochs`);
    ep.forEach((e, i) => assertString(e, `${ptr}/epochs/${i}`));
    return;
  }
  assertString(g.start, `${ptr}/start`);
  assertString(g.stop, `${ptr}/stop`);
  const step = assertNumber(g.stepSec, `${ptr}/stepSec`);
  if (step <= 0) throw new JobSchemaError('grid stepSec must be positive', `${ptr}/stepSec`);
}

function validateFacility(v: unknown, ptr: string): void {
  const f = assertObject(v, ptr);
  assertString(f.body, `${ptr}/body`);
  assertString(f.bodyFrame, `${ptr}/bodyFrame`);
  assertNumber(f.lonDeg, `${ptr}/lonDeg`);
  assertNumber(f.latDeg, `${ptr}/latDeg`);
  assertNumber(f.altKm, `${ptr}/altKm`);
  assertNumber(f.minElevationDeg, `${ptr}/minElevationDeg`);
}

function validateOperation(v: unknown, ptr: string): void {
  const o = assertObject(v, ptr);
  const op = assertString(o.op, `${ptr}/op`);
  switch (op) {
    case 'furnish':
      assertArray(o.names, `${ptr}/names`).forEach((n, i) => assertString(n, `${ptr}/names/${i}`));
      break;
    case 'propagate': {
      assertString(o.id, `${ptr}/id`);
      assertString(o.object, `${ptr}/object`);
      const method = assertString(o.method, `${ptr}/method`);
      if (method !== 'sgp4' && method !== 'twobody') throw new JobSchemaError(`unknown propagate method "${method}"`, `${ptr}/method`);
      validateGrid(o.grid, `${ptr}/grid`);
      break;
    }
    case 'runMcs':
      assertString(o.id, `${ptr}/id`);
      assertObject(o.mcs, `${ptr}/mcs`);
      break;
    case 'analyze': {
      assertString(o.id, `${ptr}/id`);
      const kind = assertString(o.kind, `${ptr}/kind`);
      if (kind !== 'range') throw new JobSchemaError(`unknown analyze kind "${kind}"`, `${ptr}/kind`);
      assertString(o.observer, `${ptr}/observer`);
      assertString(o.target, `${ptr}/target`);
      validateGrid(o.grid, `${ptr}/grid`);
      break;
    }
    case 'analyzeEclipse': {
      assertString(o.id, `${ptr}/id`);
      assertString(o.observer, `${ptr}/observer`);
      assertString(o.body, `${ptr}/body`);
      validateGrid(o.grid, `${ptr}/grid`);
      if (o.condition !== undefined) {
        const c = assertString(o.condition, `${ptr}/condition`);
        if (c !== 'umbra' && c !== 'penumbra' && c !== 'annular' && c !== 'sunlit') {
          throw new JobSchemaError(`unknown eclipse condition "${c}"`, `${ptr}/condition`);
        }
      }
      break;
    }
    case 'analyzeAccess': {
      assertString(o.id, `${ptr}/id`);
      assertString(o.observer, `${ptr}/observer`);
      assertString(o.target, `${ptr}/target`);
      validateGrid(o.grid, `${ptr}/grid`);
      if (o.facility !== undefined) validateFacility(o.facility, `${ptr}/facility`);
      break;
    }
    case 'analyzeLinkBudget': {
      assertString(o.id, `${ptr}/id`);
      assertString(o.observer, `${ptr}/observer`);
      assertString(o.target, `${ptr}/target`);
      validateGrid(o.grid, `${ptr}/grid`);
      const radio = assertObject(o.radio, `${ptr}/radio`);
      assertNumber(radio.eirpDbW, `${ptr}/radio/eirpDbW`);
      assertNumber(radio.freqHz, `${ptr}/radio/freqHz`);
      assertNumber(radio.gOverTDbK, `${ptr}/radio/gOverTDbK`);
      assertNumber(radio.dataRateBps, `${ptr}/radio/dataRateBps`);
      break;
    }
    case 'loadCatalog':
      assertString(o.file, `${ptr}/file`);
      break;
    case 'report':
      assertArray(o.from, `${ptr}/from`).forEach((f, i) => assertString(f, `${ptr}/from/${i}`));
      assertString(o.file, `${ptr}/file`);
      break;
    case 'exportOem':
      assertString(o.from, `${ptr}/from`);
      assertString(o.file, `${ptr}/file`);
      break;
    case 'exportCsv':
      assertString(o.from, `${ptr}/from`);
      assertString(o.file, `${ptr}/file`);
      break;
    default:
      throw new JobSchemaError(`unknown op "${op}"`, `${ptr}/op`);
  }
}

function validateEntity(v: unknown, ptr: string): void {
  const e = assertObject(v, ptr);
  if (e.type !== 'satellite') throw new JobSchemaError(`unknown entity type "${String(e.type)}"`, `${ptr}/type`);
  const src = assertObject(e.source, `${ptr}/source`);
  const kind = assertString(src.kind, `${ptr}/source/kind`);
  if (kind !== 'spk' && kind !== 'tle' && kind !== 'state') {
    throw new JobSchemaError(`unknown satellite source kind "${kind}"`, `${ptr}/source/kind`);
  }
}

/** Validate an unknown value as a BatchJob, or throw the specific located error. */
export function validateJob(input: unknown): BatchJob {
  const job = assertObject(input, '');
  if (job.besselBatch !== '1') {
    if (typeof job.besselBatch === 'string') throw new UnsupportedJobVersionError(job.besselBatch);
    throw new JobSchemaError('missing or non-string "besselBatch" (expected "1")', '/besselBatch');
  }
  const ops = assertArray(job.operations, '/operations');
  if (ops.length === 0) throw new JobSchemaError('a job needs at least one operation', '/operations');
  ops.forEach((o, i) => validateOperation(o, `/operations/${i}`));

  const output = assertObject(job.output, '/output');
  assertString(output.dir, '/output/dir');

  if (job.entities !== undefined) {
    const ents = assertObject(job.entities, '/entities');
    for (const key of Object.keys(ents)) validateEntity(ents[key], `/entities/${key}`);
  }
  return input as BatchJob;
}

export type { Operation, EntityDecl };
