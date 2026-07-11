import { app } from 'electron';
import { join } from 'node:path';

// Centralized kernel directory resolution. The e2e and dev runs set
// BESSEL_KERNEL_ROOT to a fixture tree; production uses the per-user app data dir.
export function kernelRoot(): string {
  return process.env['BESSEL_KERNEL_ROOT'] ?? join(app.getPath('userData'), 'kernels');
}
