# @bessel/pal-capacitor

The Capacitor Platform Abstraction Layer (PAL) implementation for Bessel.
It backs the native mobile shell (iOS) by reading kernel bytes from the
Capacitor native filesystem and importing kernel zip bundles into app data, so
the same SPICE engine runs unchanged on-device.

## Public API

- `CapacitorKernelSource` (implements `KernelSource` from `@bessel/pal`): lists,
  resolves, and reads kernels from a directory in a Capacitor `Directory` (default
  `Directory.Data`). `resolve` of a missing kernel throws a typed, located
  `PalError` with code `kernel-not-found`.
- `importKernelZip(zipBytes, destDir, directory?)`: unzips a kernel bundle with
  fflate, flattens entries to leaf names, skips directory entries, writes each
  file into `destDir`, and returns the written paths.
- `capacitorCapabilities` (`Capabilities`): declares `target: 'capacitor'`,
  `nativeShare: true`, and `pythonBridge`, `webxr`, `fileDialogs` all `false`.

```ts
import { CapacitorKernelSource, importKernelZip } from '@bessel/pal-capacitor';

await importKernelZip(zipBytes, '/kernels');
const source = new CapacitorKernelSource('/kernels');
const bytes = await source.read(await source.resolve('naif0012.tls'));
```

## Dependency rule

Depends on: `@bessel/pal` (plus Capacitor `@capacitor/core`, `filesystem`,
`preferences`, `share`, and `fflate`). Part of the PAL implementation layer: it
implements the `@bessel/pal` interface and is injected by the Capacitor shell at
startup. The core never imports this package.

## Tests

Tests live in `packages/pal-capacitor/src/kernel-source.test.ts`. The suite mocks
the Capacitor Filesystem and asserts `importKernelZip` extracts entries, flattens
leaf names, skips directory entries, and round-trips bytes (including a larger
than 32KB file that exercises the base64 chunk boundary).

## Status / limitations

`CapacitorKernelSource` (filesystem reads) and `importKernelZip` are implemented.
The Preferences-backed Storage and the Share-backed link/file sharing referenced
by the capabilities are not yet exported here; native filesystem kernel import via
the OS picker lands in Phase 3. The Python scripting bridge is Electron-only and
is intentionally absent.
