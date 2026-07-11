# @bessel/pal-node

The headless Node IO a shell injects into the `@bessel/sdk` batch runner: a directory-backed `KernelSource` and an artifact writer confined to an output directory. Node-only (it imports `node:fs`); never pulled into a browser bundle. PAL-implementation layer.

## Public API

- `createNodeKernelSource(dir): KernelSource` serves kernels from `dir` (reusing the Electron `NodeKernelSource`); a missing kernel throws a located `PalError`.
- `createNodeFileWriter(outDir): (relPath, data) => Promise<void>` writes under `outDir`, creating parent directories; a relative path that escapes the directory (via `..` or an absolute path) fails loudly rather than writing outside the sandbox.
- `createNodeRunIo({ kernelDir, outDir }): NodeRunIo` assembles the two into the runner's `RunIo` shape (`{ kernels, writeFile }`).
- `NodeKernelSource` (re-exported), `NodeRunIo`.

```ts
import { createNodeRunIo } from '@bessel/pal-node';
import { runJob } from '@bessel/sdk';

const io = createNodeRunIo({ kernelDir: '/path/to/kernels', outDir: '/path/to/out' });
const result = await runJob({ job, io });
```

## Dependency rule

Depends on: `@bessel/pal` (the `KernelSource` interface and `PalError`) and `@bessel/pal-electron/node` (reusing `NodeKernelSource`). It does not import `@bessel/sdk`; its `NodeRunIo` is structurally equal to the SDK's `RunIo`, so they connect at the call site without a dependency from a PAL implementation back into core.

## Tests

`packages/pal-node/src/pal-node.test.ts` resolves and reads a real fixture kernel, asserts the missing-kernel `PalError`, round-trips a nested write inside a temp output dir, and asserts the confinement check rejects a `..` escape.

## Status / limitations

Provides exactly what the headless runner needs (kernels in, artifacts out). It is not a full `Platform` (no `Storage`/`Share`/`Capabilities`); the GUI shells use `@bessel/pal-web`, `@bessel/pal-electron`, or `@bessel/pal-capacitor`.
