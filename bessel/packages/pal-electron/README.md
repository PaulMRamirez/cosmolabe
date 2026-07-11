# @bessel/pal-electron

The Electron Platform Abstraction Layer (PAL) implementation for Bessel. It backs the desktop shell with a Node filesystem reached over a typed IPC bridge from preload, meta-kernel (.tm) path resolution, native file dialogs, and an optional Python scripting bridge.

## Public API

Package root (`@bessel/pal-electron`, safe for the renderer bundle):

- `createElectronPlatform(bridge)`: builds the renderer `Platform` (kernels, fs, storage, share, capabilities) from the injected `BesselBridge`.
- `electronCapabilities`: the static `Capabilities` (target `electron`, `pythonBridge`, `nativeShare`, `fileDialogs` true; `webxr` false).
- `IpcKernelSource`: a `KernelSource` that reads kernels through the IPC bridge.
- `openKernelDialog(bridge)`, `saveProductDialog(bridge, defaultPath)`: native dialog wrappers.
- `runBatchGeometry(bridge, request)`: Python bridge wrapper; throws a typed `PalError` when Python is unavailable.
- IPC contract: `BESSEL_IPC` channel names, the `BesselBridge` interface, and the `SerializedPalError`, `DialogOpenOptions`, `DialogSaveOptions`, `PythonRunRequest`, `PythonRunResult` types (the single source of truth shared by preload/main and renderer).

Node-only entry (`@bessel/pal-electron/node`, kept out of the renderer so it never imports `node:fs`):

- `NodeKernelSource`: a main-process `KernelSource` over `node:fs`.
- `resolveMetaKernel`, `resolveLoadableKernels`, `MetaKernel`: parse a `.tm` (PATH_VALUES, PATH_SYMBOLS, KERNELS_TO_LOAD) into absolute loadable kernel paths.

```ts
import { createElectronPlatform } from '@bessel/pal-electron';
const platform = await createElectronPlatform(window.bessel!);
```

## Dependency rule

Depends on: `@bessel/pal` (the PAL interface). Part of the PAL implementation layer. It contains no `@bessel` core or UI imports, and the IPC contract module deliberately avoids importing `electron` so the package stays interface-only at the type level.

## Tests

Tests live in `packages/pal-electron/src/*.test.ts`: `capabilities.test.ts`, `ipc-kernel-source.test.ts`, `kernel-source.test.ts`, `meta-kernel.test.ts`, and `dialogs-python.test.ts`, with fixtures under `src/__fixtures__`. They cover the capability flags, kernel reads over IPC and `node:fs`, meta-kernel resolution, dialogs, and the Python bridge gate.

## Status / limitations

The app-data `FileSystem` is intentionally unimplemented: it fails loudly with a typed `not-supported` `PalError` rather than silently no-opping, until the main-process channels are wired. `RendererStorage` is a thin `localStorage` wrapper; `ElectronShare.shareLink` copies the URL to the clipboard.
