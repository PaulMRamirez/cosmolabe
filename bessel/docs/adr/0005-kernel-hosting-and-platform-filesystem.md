# ADR-0005: Kernel hosting and per-platform filesystem strategy

Status: Accepted
Date: 2026-06-07

## Context

SPICE kernels can be large, and how they are obtained differs sharply by target.
The browser cannot read arbitrary local files without user gestures and faces
CORS limits against the PDS NAIF mirror. Mobile has a sandboxed filesystem.
Desktop has full local access and is where meta-kernel (.tm) path resolution
matters most for parity with Cosmographia. The SPICE engine (ADR-0004) is
deliberately ignorant of all this; the PAL KernelSource absorbs it.

## Decision

Implement KernelSource three ways:

- pal-web: load kernels over HTTP using range requests, cache them in OPFS keyed
  by a stable identity, and support drag-and-drop import via the File System
  Access API as a fallback. Provide an optional companion kernel proxy service: a
  small, read-only, CORS-scoped server that fronts the PDS NAIF mirror and serves
  range requests. In development this can be a local static server with range
  support.
- pal-capacitor: use the Capacitor Filesystem for kernels and app data, with
  kernel bundles imported as a zip or downloaded on demand into app storage.
- pal-electron: use the Node filesystem over the typed IPC bridge, with full
  meta-kernel (.tm) path resolution so a .tm with relative kernel paths resolves
  against the local tree, matching desktop Cosmographia behavior.

## Consequences

- The PWA can operate offline against cached kernels once a bundle is cached,
  which the Phase 2 offline e2e test exercises.
- The desktop target reaches Cosmographia parity for meta-kernel workflows.
- A deployed companion proxy is an operational dependency for the web target when
  pulling from PDS NAIF; it is read-only and scoped, so it carries low risk.
- Caching correctness depends on stable kernel identity; KernelSource must report
  one.

## Consequences for security

The companion proxy is read-only and CORS-scoped. Kernel data is not committed to
the repository; .claudeignore excludes bulk kernel files, and small redistributable
fixtures live under kernels/ for tests.
