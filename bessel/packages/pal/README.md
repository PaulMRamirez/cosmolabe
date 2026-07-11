# @bessel/pal

The Platform Abstraction Layer interface for Bessel. It defines the typed contracts (kernel access, filesystem, storage, share, capabilities) that core and UI depend on, while each shell (web, Capacitor, Electron) injects one concrete implementation at startup. This is the PAL interface layer: it contains interfaces and the contract suite only, never a concrete implementation.

## Public API

- `KernelSource` and `KernelHandle`: enumerate, resolve, and read kernel bytes (full reads plus an optional `readRange` for HTTP range or file seek). The SPICE engine reads kernels only through this interface.
- `FileSystem`: `readFile`, `writeFile`, `exists`, `remove`, `list`.
- `Storage`: `get` / `set` / `remove` string key-value persistence.
- `Share`, `ShareLinkRequest`, `ShareFileRequest`: `shareLink` and `shareFile` for native share sheets or link copy.
- `Capabilities` and `PlatformTarget` (`'web' | 'capacitor' | 'electron'`): per-target feature flags (pythonBridge, webxr, nativeShare, fileDialogs) so the UI degrades gracefully.
- `Platform`: the aggregate (`kernels`, `fs`, `storage`, `share`, `capabilities`) a shell injects and core consumes.
- `PalError` with `PalErrorCode` (`'kernel-not-found' | 'read-failed' | 'write-failed' | 'not-supported' | 'storage-failed'`): a located, typed error so PAL failures fail loudly.

The `@bessel/pal/testing` subpath exports `kernelSourceContract` and the `KernelSourceFixture` type: a shared conformance suite implementations run against their own fixtures.

```ts
import { kernelSourceContract } from '@bessel/pal/testing';

kernelSourceContract('pal-web', () => ({
  source: makeWebKernelSource(),
  presentName: 'naif0012.tls',
  missingName: 'does-not-exist.bsp',
}));
```

## Dependency rule

Depends on: nothing (pure interfaces, no @bessel runtime dependencies). Part of the PAL interface layer. Core and UI import these interfaces; concrete implementations (pal-web, pal-electron, pal-capacitor) implement them, and only shells inject one at startup.

## Tests

This package ships no `*.test.ts` of its own. Instead `src/testing/kernel-source-contract.ts` provides `kernelSourceContract`, the conformance suite that pal-web and pal-electron run against their own fixtures (SPEC Section 6) so the engine behaves identically no matter how kernel bytes arrive. The suite asserts list, resolve to a stable handle, full read, range read consistency, and a typed `PalError` on a missing kernel.

## Status / limitations

Interfaces are stable for the web, Capacitor, and Electron targets. Only `KernelSource` currently has a shared contract suite; FileSystem, Storage, and Share contract suites are not yet provided here. Some capability flags (pythonBridge, webxr) gate features deferred to later phases.
