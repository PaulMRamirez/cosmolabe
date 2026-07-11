# @bessel/selene-design

The **Selene Ops** design system as a pnpm-workspace package: warm regolith-gray dark-UI
tokens (CSS variables) + typed React 18 components for lunar mission-GIS / ops-console /
telemetry-dense surfaces.

Strict-clean (`strict`, `noUncheckedIndexedAccess`, zero unused), automatic JSX runtime
(no `import React`). In dev it resolves to **TS source** (instant HMR via the `development`
export condition); for publishing it builds **compiled ESM + `.d.ts`** with `tsup`. Fonts are
**vendored** for offline PWA use.

---

## Install (monorepo)

1. Drop this folder into your workspace, e.g. `packages/selene-design/`.
2. It's already named `@bessel/selene-design`. Add it to a consuming app:
   ```jsonc
   // apps/web/package.json
   "dependencies": { "@bessel/selene-design": "workspace:*" }
   ```
3. `pnpm install`.

If your `pnpm-workspace.yaml` already globs `packages/*`, nothing else is needed.

> **Dev vs. publish.** The `.` export has a `development` condition pointing at `src/index.ts`, so
> in `vite dev`/`vite build` you get TS source (instant HMR, no prebuild). The `default` condition
> points at `dist/`, used when the package is published/consumed without the dev condition. To force
> source resolution in tooling that doesn't set it, add `resolve.conditions: ['development']` to the
> consuming app's Vite config.

---

## Build (compiled output)

```bash
pnpm --filter @bessel/selene-design build      # tsup → dist/index.js + dist/index.d.ts
pnpm --filter @bessel/selene-design typecheck  # tsc --noEmit (strict gate)
```

`tsup` emits ESM + declaration maps; React is external (peer). CSS + fonts are **not** bundled —
they ship straight from `src/` via the `exports` map so `url()` font paths stay intact and your
app's bundler fingerprints them. `prepublishOnly` runs `fetch-fonts` + `build`.

---

## Fonts (vendored — offline PWA)

Binaries aren't committed. Fetch them once, then commit:

```bash
pnpm --filter @bessel/selene-design fetch-fonts
```

This downloads the **variable** Inter Tight + JetBrains Mono `.woff2` (latin) into
`src/tokens/fonts/`; `tokens/fonts.css` declares `@font-face` with the exact family names the
tokens use, so nothing else changes. Until fetched, the stacks fall back to `system-ui` /
`ui-monospace`.

**Workbox precache — required.** vite-plugin-pwa's default `globPatterns` does **not** include
`woff2`, so add it or the fonts won't be available offline:

```ts
// apps/web/vite.config.ts
VitePWA({
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
});
```

Because the fonts resolve to local build assets (not a CDN), no runtime-cache rule is needed —
precache covers them. Remove any old Google-Fonts `<link>`/`@import` from your shells.

---

## Use

Load the stylesheet **once** at your app root (it `@import`s all tokens + fonts):

```ts
// apps/web/src/main.tsx
import '@bessel/selene-design/styles.css';
```

Then import components:

```tsx
import { AssetRow, Tag, Gauge, SectionLabel, Divider, Button } from '@bessel/selene-design';

<SectionLabel right="5 active">Assets</SectionLabel>
<AssetRow id="RV-01" name="Prospector I" role="Ice prospecting" kind="rover" soc={0.82} selected />
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
  <Gauge label="Comms" value={0.86} color="var(--cyan)" />
  <Gauge label="Sun" value={0.61} color="var(--amber)" />
  <Gauge label="Energy" value={0.34} color="var(--green)" />
</div>
```

All color/spacing is driven by CSS variables (`--amber`, `--bg-1`, `--ink-2`, `--radius-md`, …),
so you can theme or reference tokens anywhere without importing JS.

### Tokens in JS (for `@bessel/ui` / charts / Three.js)

Tokens are also exported as typed objects, so non-CSS consumers (your `@bessel/ui` theme, chart
configs, WebGL materials) can share them:

```ts
import { tokens, tokenValues } from '@bessel/selene-design';

tokens.accent.primary;   // 'var(--amber)'  — resolves against styles.css (themeable)
tokenValues.amber;       // 'oklch(0.80 0.15 70)' — a real color for canvas/WebGL/math
```

Wire `tokens` into `@bessel/ui`'s theme provider to make the two libraries share one source of
truth. (If you tell me `@bessel/ui`'s theme-token shape, I'll add an adapter that maps these to it
exactly.)

---

## What's included

**Tokens** (`src/styles.css` → `src/tokens/`): `fonts`, `colors`, `typography`, `spacing`, `elevation`.

**Components** (`src/components/`):
- `core/` — `Button` (primary / secondary / ghost / critical)
- `layout/` — `SectionLabel`, `Divider`
- `data-display/` — `Tag`, `MiniBar`, `Metric`, `Gauge`, `TeleCell`, `StatusDot`, `AssetRow`, `EventRow`

Every component exports its prop types alongside it (e.g. `import type { TagTone } from '@bessel/selene-design'`).

---

## Notes / caveats for this stack

- **Fonts** are vendored locally (see the Fonts section) — run `fetch-fonts` and commit. No CDN at
  runtime, so they precache for offline once you add `woff2` to the Workbox `globPatterns`.
- **`@bessel/ui` overlap.** You already have a component library. This package is intentionally
  small and ops-flavored; treat it as a token layer + a few mission-GIS-specific widgets, and pull
  primitives from `@bessel/ui` where they exist. The tokens are pure CSS vars so the two can
  coexist — or I can re-express these as `@bessel/ui` theme tokens instead.
- **The `LunarMap`** (the SVG polar map) is **not** in this package — it's a product surface, not a
  primitive. It lives in the source project's `ui_kits/selene-ops/`. Given your Three.js + SPICE
  stack you'd likely render the real thing against actual DEM/ephemeris rather than reuse the mock;
  happy to help adapt the overlay semantics (ice heatmap, PSR, graticule) to a Three.js layer.
- **No Three.js / WebGL dependency** here — these are plain DOM/SVG React components for the 2D
  chrome (rails, inspectors, telemetry, feeds) that frames a map view.
