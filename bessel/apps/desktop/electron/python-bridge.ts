// Python scripting bridge (Electron main only). Spawns python for batch geometry
// products, gated on python being present. Fails loudly with a clear error when
// python or its output is unavailable; the render path never depends on python.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PythonRunRequest, PythonRunResult } from '@bessel/pal-electron';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/batch_geometry.py');

let cached: boolean | null = null;

function pythonExecutable(): string {
  return process.env['BESSEL_PYTHON'] ?? 'python3';
}

/** Detect whether a usable python interpreter is present (cached). */
export async function detectPython(): Promise<boolean> {
  if (cached !== null) return cached;
  cached = await new Promise<boolean>((res) => {
    const child = spawn(pythonExecutable(), ['--version']);
    child.on('error', () => res(false));
    child.on('close', (code) => res(code === 0));
  });
  return cached;
}

/** Run the batch geometry script with a JSON request on stdin and parse the result. */
export async function runPython(request: PythonRunRequest): Promise<PythonRunResult> {
  if (!(await detectPython())) {
    throw new Error('Python scripting bridge unavailable: no python interpreter found');
  }
  return new Promise<PythonRunResult>((res, reject) => {
    const child = spawn(pythonExecutable(), [scriptPath]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python bridge failed (exit ${code}): ${err.trim()}`));
        return;
      }
      try {
        res(JSON.parse(out) as PythonRunResult);
      } catch {
        reject(new Error(`Python bridge returned invalid JSON: ${out.slice(0, 200)}`));
      }
    });
    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}
