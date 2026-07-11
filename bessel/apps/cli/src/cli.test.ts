// The CLI end to end: a real job file plus a kernel in the job directory runs to a written
// artifact and exit 0; an invalid job is exit 2; a dry run is exit 0 with no writes; bad
// args are exit 4. Calls runCli directly (no process spawn). (STK_PARITY_SPEC, SDK.)

import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { runCli } from './cli.ts';

const fixturesDir = fileURLToPath(new URL('../../../kernels/fixtures', import.meta.url));

const job = {
  besselBatch: '1',
  entities: { SAT: { type: 'satellite', source: { kind: 'state', epoch: '2025-03-01T00:00:00', centralBody: 399, r: [7000, 0, 0], v: [0, 7.546, 0] } } },
  operations: [
    { op: 'furnish', names: ['naif0012.tls'] },
    { op: 'propagate', id: 'eph', object: 'SAT', method: 'twobody', grid: { start: '2025-03-01T00:00:00', stop: '2025-03-01T00:30:00', stepSec: 600 } },
    { op: 'exportOem', from: 'eph', file: 'eph.oem' },
  ],
  output: { dir: 'artifacts' },
};

describe('bessel CLI', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bessel-cli-'));
    await copyFile(join(fixturesDir, 'naif0012.tls'), join(dir, 'naif0012.tls'));
    await writeFile(join(dir, 'job.json'), JSON.stringify(job), 'utf8');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs a job to an OEM artifact and exits 0', async () => {
    const out = await runCli(['run', join(dir, 'job.json')]);
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout).status).toBe('ok');
    const artifacts = await readdir(join(dir, 'artifacts'));
    expect(artifacts).toContain('eph.oem');
  });

  it('validate command reports a valid job (exit 0)', async () => {
    const out = await runCli(['validate', join(dir, 'job.json')]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toMatch(/valid/);
  });

  it('rejects an invalid job with exit 2 and a pointer', async () => {
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ besselBatch: '1', operations: [], output: { dir: 'x' } }), 'utf8');
    const out = await runCli(['validate', join(dir, 'bad.json')]);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toMatch(/\/operations/);
  });

  it('dry run exits 0 and writes nothing', async () => {
    const out = await runCli(['run', join(dir, 'job.json'), '--dry-run']);
    expect(out.exitCode).toBe(0);
    await expect(readdir(join(dir, 'artifacts'))).rejects.toThrow(); // dir never created
  });

  it('bad arguments exit 4 with usage', async () => {
    const out = await runCli(['frobnicate', 'x']);
    expect(out.exitCode).toBe(4);
    expect(out.stderr).toMatch(/usage/);
  });
});
