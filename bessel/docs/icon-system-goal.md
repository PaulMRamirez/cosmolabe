# Goal: a coherent, accessible icon system for Bessel

Status: IMPLEMENTED (2026-06-22) on the feat/icon-system branch. Library: Lucide
(ISC), chosen by the workflow's evidence (license, currentColor theming, tree-shaking,
style fit). The selene Icon component (universal Lucide via an explicit static map)
and DomainIcon component (11 bespoke concept glyphs) shipped; the universal unicode
glyphs were migrated, and F07/F08/F35 (FOV/Footprint/Share viewcontrols) resolved
with the sensor-fov / sensor-footprint / share icons. Tabs and result cards carry
concept icons. The bespoke set was persona blind-read AND human-visually reviewed: the
first pass collided with common icons (FOV-as-beaker, propagate-as-eye, conjunction-as-x,
walker-as-gear), so those were re-spun and re-rendered until each read correctly before
sign-off. Budget intact: the whole system adds ~4 KB to the first-paint shell
(284.98 of the 345 KB cap). On F35: the inline FOV/Footprint toggles were kept (now
icons), not removed, since the instruments e2e asserts them as a contextual affordance.

Follows the UI simplification pass
(docs/ui-simplification-goal.md), which deferred F07/F08/F35 (the FOV/Footprint/
Share viewcontrols strip) because the codebase had no real icon system, only
unicode glyphs (font-dependent, inconsistent, some ambiguous). This goal builds
the system, which both unblocks those items and upgrades the glyph icons already
shipped.

## North star

A two-tier icon system: universal actions render an established, broadly-accepted
open-source icon set; domain concepts (sensor FOV cone, footprint, beta angle,
B-plane, Walker, porkchop, ground track, propagate, conjunction) render a small
bespoke SVG set we design ourselves. Every icon is themeable (currentColor),
accessible (an icon-only control always carries an accessible name), and ships only
when it is blind-recognizable; where a glyph is marginal it is paired with a short
label rather than replacing the word. Resolving this resolves F07/F08/F35 and
migrates the shipped unicode glyphs to one consistent family, with the first-paint
shell budget unchanged.

## Decisions (resolved 2026-06-22)

1. Scope: the FULL icon system (foundation + library for universal + bespoke domain
   set + migrate the existing unicode glyphs), not just the deferred strip.
2. Library: chosen by EVIDENCE in the workflow (a perf/design evaluation of license,
   style fit with selene, currentColor support, tree-shaking, and bundle impact),
   not pre-picked.
3. Validation: a PERSONA recognizability workflow (the six analyst personas plus the
   first-run/educator do a blind "what does this control do?" read of each domain
   icon), not designer taste alone.

## Approach

- Foundation: an `Icon` component in `@bessel/selene-design` rendering inline SVG with
  `currentColor` and the control sizing grid; `aria-hidden` on the glyph (the selene
  Button's `ariaLabel` carries the name). Tree-shaken inline SVG, never an icon font.
- Universal vs domain split: universal actions (play, pause, record, stop, share,
  copy, close, pin, settings, edit, trash, search, chevrons, zoom, move, export,
  reset) map to the chosen library; domain concepts get bespoke SVGs.
- The right perspectives: an icon/visual designer drafts candidates; the domain
  personas + first-run validate recognizability blind; an accessibility pass checks
  stroke contrast in both themes, focus/hover, hit-target, and the accessible-name
  discipline; a front-end/perf pass vets the library license and the shell budget.
- Safety net (so nothing is forced): an icon-only control always keeps its tooltip +
  aria-label, and a glyph ships only if it passes the blind read; otherwise it is
  icon + short label or stays text. An icon is an upgrade only when it is at least as
  clear as the word.

## Gate (completion check)

- `pnpm verify` green with the per-chunk size budgets UNCHANGED (the first-paint
  shell floor must not regress; icons on first-paint surfaces are measured).
- `pnpm e2e` green including the axe a11y scan; every icon-only control has an
  accessible name and a tooltip.
- F07/F08/F35 resolved with rendered icons reviewed and approved by a human (the
  real visual recognizability check), and the shipped unicode glyphs migrated to the
  system with their data-testids preserved.

## Phasing

- Phase 0 (decide + found): the workflow's library recommendation and the `Icon`
  foundation in selene, with the budget gate.
- Phase 1 (design + validate): the bespoke domain icon set drafted, persona
  recognizability tested, a11y/perf reviewed, rendered for human approval.
- Phase 2 (migrate): replace the shipped unicode glyphs with the system (low risk,
  testids preserved), for consistency.
- Phase 3 (resolve the deferred strip): F07/F08/F35 with the real icons, and the F35
  de-dup re-decided with the icon in hand.
