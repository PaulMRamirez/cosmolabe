# ADR-0002: Tri-target delivery from one codebase behind a Platform Abstraction Layer

Status: Accepted
Date: 2026-06-07

## Context

Cosmographia is desktop only. Bessel must reach the browser, mobile, and the
desktop without maintaining three codebases. The 3D engine, SPICE engine, catalog
parser, scene graph, timeline, and UI are identical across targets; only file
access, kernel transport, sharing, and a few capabilities differ.

We also want to avoid coupling the product to any single runtime, consistent with
the stated aversion to bundle lock-in and vendor durability risk.

## Decision

One pnpm workspace, three delivery targets:

- Progressive Web App: Vite plus vite-plugin-pwa (Workbox service worker and web
  manifest). apps/web is the canonical build all targets consume.
- Mobile: Capacitor wraps apps/web/dist into iOS and Android (apps/mobile).
- Desktop: electron-vite (apps/desktop) with an explicit, typed IPC bridge.

A Platform Abstraction Layer (@bessel/pal) defines interfaces (KernelSource,
FileSystem, Storage, Share, Capabilities). The core and UI depend only on these
interfaces. Each shell injects one concrete implementation (pal-web,
pal-capacitor, pal-electron) at startup.

We use electron-vite with an explicit bridge rather than
@capacitor-community/electron for the desktop target.

## Consequences

- The core never imports a platform API, so targets are swappable and the product
  is not coupled to Capacitor's plugin lifecycle on the desktop.
- electron-vite keeps the desktop bridge explicit and gives first-class Vite DX;
  the cost is that we do not reuse Capacitor Filesystem on desktop and instead
  write pal-electron over Node fs. This is acceptable and preferred for clarity.
- CesiumJS is not embedded. Surface context is handled by interoperating via CZML
  export and by deep-linking to MMGIS, keeping Bessel focused on orbital and
  geometry visualization.
- A small amount of per-target shell code and three PAL implementations are the
  only platform-specific surfaces; everything else is shared.

## Alternatives considered

- Quasar (single codebase to web, Electron, Capacitor): strong, but Vue-centric;
  Bessel's prior design and the React plus Three.js ecosystem favor React.
- @capacitor-community/electron: reduces PAL branches by reusing Capacitor plugins
  on desktop, but is community-maintained, lags Electron releases, and couples the
  desktop target to the Capacitor lifecycle. Rejected for durability and coupling.
