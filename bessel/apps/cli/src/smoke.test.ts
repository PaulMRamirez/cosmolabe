// Smoke test for the BUILT bessel binary. Unlike cli.test.ts (which calls runCli
// in-process), this builds dist/main.js via the real esbuild step, then spawns the
// bundled binary as a child process against a fixture job and asserts exit 0 plus a
// written OEM artifact. This proves the bundle resolves @bessel/* sources and locates
// cspice.wasm next to dist/main.js at runtime. (STK_PARITY_SPEC, SDK.)

import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, it, expect } from 'vitest';

const run = promisify(execFile);

const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const builtBin = join(cliRoot, 'dist', 'main.js');
const buildScript = join(cliRoot, 'scripts', 'build.mjs');
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Spawning a fresh node and running esbuild is heavier than the in-process tests.
const BUILD_TIMEOUT = 120_000;

describe('bessel built binary (smoke)', () => {
  let dir: string;

  beforeAll(async () => {
    if (!(await exists(builtBin))) {
      await run(process.execPath, [buildScript], { cwd: dirname(buildScript) });
    }
    expect(await exists(builtBin), `expected built binary at ${builtBin}`).toBe(true);
  }, BUILD_TIMEOUT);

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('runs a job to an OEM artifact and exits 0', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bessel-cli-smoke-'));
    await copyFile(join(fixturesDir, 'naif0012.tls'), join(dir, 'naif0012.tls'));
    await writeFile(join(dir, 'job.json'), JSON.stringify(job), 'utf8');

    const { stdout } = await run(process.execPath, [builtBin, 'run', join(dir, 'job.json')], { cwd: dir });
    expect(JSON.parse(stdout).status).toBe('ok');

    const artifacts = await readdir(join(dir, 'artifacts'));
    expect(artifacts).toContain('eph.oem');
  });
});
