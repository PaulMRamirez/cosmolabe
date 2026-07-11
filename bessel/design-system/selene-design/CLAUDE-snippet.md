# Paste this into your other repo's CLAUDE.md

Copy the block below into the root `CLAUDE.md` of your Bessel project so Claude Code designs
in-system. Adjust the path if you place the package somewhere other than `packages/selene-design/`.

---

## Design system — @bessel/selene-design

UI in this repo follows the **Selene Ops** design system in `packages/selene-design/`.

- **Before building any UI**, read `packages/selene-design/README.md` and the parent
  `readme.md` it references (color/type/spacing/copy rules + component manifest).
- **Load tokens once** at the app root: `import '@bessel/selene-design/styles.css'`.
- **Use components** from `@bessel/selene-design` (`Button`, `Tag`, `Gauge`, `AssetRow`,
  `EventRow`, `StatusDot`, `SectionLabel`, `Divider`, `Metric`, `MiniBar`, `TeleCell`).
- **Use CSS-variable tokens** for all color/spacing (`--amber` primary, `--cyan` data/ice,
  `--bg-0..3` surfaces, `--ink-0..3` text, `--radius-*`). Never hardcode hex.
- **Rules to honor:** warm regolith grays (never blue-gray); single amber primary; cyan for
  data/instruments; red reserved for emergency only. Inter Tight for UI prose; JetBrains Mono
  (tabular, slashed zero) for every number, coordinate, ID, timestamp, label, and tag. Flat
  surfaces + 0.5px hairlines for elevation; tight radii; selection = 2px left accent border.
  Terse operator-grade copy; UPPERCASE mono labels, sentence-case names/messages; no emoji.
- Prefer existing `@bessel/ui` primitives where they cover the need; use selene-design for tokens
  and the mission-GIS-specific widgets.
- **Tokens in JS:** `import { tokens, tokenValues } from '@bessel/selene-design'` for charts /
  Three.js / `@bessel/ui` theme wiring.

### One-time setup (already done if installed)
- `pnpm --filter @bessel/selene-design fetch-fonts` — vendor the woff2 binaries (commit them).
- Add `woff2` to vite-plugin-pwa `workbox.globPatterns` so fonts precache offline.
- Dev uses TS source via the `development` export condition; `pnpm --filter @bessel/selene-design build` emits compiled ESM + d.ts for publishing.
