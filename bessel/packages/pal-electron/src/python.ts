// Renderer-side Python scripting bridge wrapper. Gates on python presence and
// fails loudly with a typed error when unavailable; the render path never depends
// on python.

import { PalError } from '@bessel/pal';
import type { BesselBridge, PythonRunRequest, PythonRunResult } from './ipc-contract.ts';

export async function runBatchGeometry(
  bridge: BesselBridge,
  request: PythonRunRequest,
): Promise<PythonRunResult> {
  if (!(await bridge.pythonAvailable())) {
    throw new PalError('Python scripting bridge is unavailable', 'not-supported', 'runBatchGeometry');
  }
  return bridge.runPython(request);
}
