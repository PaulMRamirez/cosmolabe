# @bessel/pal-web

The web Platform Abstraction Layer (PAL) implementation for Bessel. It supplies
the browser-backed services (`KernelSource`, `FileSystem`, `Storage`, `Share`,
`Capabilities`) that the web shell injects into core and UI at startup.

## Public API

- `createWebPlatform(options): Promise<Platform>`: builds the full `Platform`
  the shell injects. Wires an `HttpKernelSource`, an OPFS `FileSystem`, a
  `localStorage`-backed `Storage`, a `Share`, and `webCapabilities`.
- `WebPlatformOptions`: `kernelUrls` (logical kernel name to fetchable URL) and
  an optional `cache` flag (OPFS kernel cache, on by default when available).
- `HttpKernelSource`: resolves logical kernel names to URLs, fetches them
  (`read`), supports HTTP range reads (`readRange`), and reads from the OPFS
  cache first. Throws a located `PalError` on unknown names or failed fetches.
- `OpfsKernelCache` and `openKernelCache()`: content-addressed OPFS cache for
  fetched kernels; `openKernelCache()` returns `undefined` when OPFS is absent.
- `webCapabilities`: the web target's feature flags (webxr, native share, file
  dialogs; no python bridge).

```ts
import { createWebPlatform } from '@bessel/pal-web';

const platform = await createWebPlatform({
  kernelUrls: { de440: '/kernels/de440.bsp' },
});
const handle = await platform.kernels.resolve('de440');
const bytes = await platform.kernels.read(handle);
```

## Dependency rule

Depends on: `@bessel/pal`. Part of the PAL implementation layer. It implements
the `@bessel/pal` interfaces and is injected by the web shell; core never imports
it (the dependency rule, CLAUDE.md).

## Tests

Tests live in `packages/pal-web/src/*.test.ts`:
`kernel-source.test.ts` covers `HttpKernelSource` resolution, fetch, cache hits,
and located `PalError`s; `opfs-cache.test.ts` covers the OPFS cache round-trip
and its graceful absence.

## Status / limitations

`Storage` uses `localStorage` and `Share.shareFile` falls back to a download
anchor when the Web Share API is unavailable. OPFS features (kernel cache and
`FileSystem`) are absent on browsers without OPFS, in which case kernel reads
fall back to the network.
