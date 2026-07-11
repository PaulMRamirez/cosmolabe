# M-0005: Naming and publish plan

Status: Accepted; neutral-scope migration flagged review-on-return
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: yes; neutral-scope migration timing, and the besselian defensive claim (added 2026-07-10, post-agreement)

## Context
Both names deserve to survive and label different layers; libraries meant for external adoption should not feel like a dependency on someone's app (Aaron's neutral-scope principle). Registry facts as of 2026-07-09: npm `bessel` taken (SheetJS), `cosmolabe` and `cspice-wasm` free, PyPI and crates.io clear on both, GitHub handles `bessel` and `cosmolabe` taken. See docs/design/01 section 6.

## Decision
Cosmolabe is the product and instrument: the app, the panel, the repo name. Bessel is the compute identity: engine packages, SDK, and the CLI binary `bessel`. Libraries publish under `@cosmolabe` as the pragmatic interim scope; migration to a vendor-neutral scope (Open Mission Foundation preferred if its timeline supports it) is recorded here and decided jointly (review-on-return). The CLI installs from its scoped package; docs note that unscoped `npx bessel` resolves to SheetJS.

## Consequences
Names claimed at day zero. `besselian` is additionally claimed defensively (free on npm, PyPI, and crates.io as of 2026-07-10) and held as the future name of the Besselian-elements module, eclipse and occultation machinery inside the access and events engines; it is post-window backlog per docs/design/04 section 4, not nine-week scope. One sentence carries the brand architecture: Cosmolabe is what you see; Bessel is what computes.
