# ADR-0009: Production engineering baseline

Status: Accepted
Date: 2026-06-07

## Context

The program objective is a fully featured, production quality, efficient
application suitable for the NASA-AMMOS product suite. "Production quality" and
"efficient" must be enforceable, not aspirational, and in a /goal-driven build
that means machine-verifiable gates. A suite-ready repository also carries governance
expectations: community health files, a contribution process, and a security
policy.

## Decision

Four pillars, all enforced by runnable commands:

1. CI mirrors the /goal gates. .github/workflows/ci.yml runs the same command
   vocabulary as the completion checker (pnpm verify, build:desktop, audit:prod,
   e2e, lhci), so the developer, the checker, and CI cannot disagree.
2. Efficiency budgets are hard gates.
   - Bundle: .size-limit.json caps the web app shell at 350 KB gzip of initial
     JS (the CSPICE WASM is lazy loaded and capped separately at 4 MB).
   - Lighthouse: lighthouserc.json asserts performance at or above 0.8 and
     accessibility and best practices at or above 0.9 on the built PWA
     (gated from Phase 2 on).
   - pnpm size joins the verify gate so budgets are checked on every phase.
   - Runtime frame-rate targets remain NFRs measured by pnpm bench
     (informational, not a CI gate, because headless CI GPU timing is flaky).
3. Dependency hygiene is a gate. pnpm audit:prod fails CI on high or critical
   production vulnerabilities.
4. Releases are deliberate. Changesets drive versioning and changelogs across
   the workspace; maturity is expressed through release channels (alpha, beta,
   stable npm dist-tags and GitHub pre-releases). Governance: LICENSE (Apache-2.0),
   CONTRIBUTING with DCO sign-off, CODE_OF_CONDUCT, SECURITY with private
   reporting, and a PR template that restates the gate.

## Consequences

- "Production quality" has a definition the /goal checker can verify; Phase 5
  exists to certify it (signed-artifact pipeline, budgets green, audit clean,
  docs complete).
- Budgets shape design early: lazy WASM, code splitting, and lean dependencies
  are forced by the size gate rather than retrofitted.
- DCO sign-off is the contribution legal mechanism unless JPL or NASA-AMMOS
  policy requires a CLA; revisit at organization transfer (open decision in
  SPEC Section 11).
- The Lighthouse gate runs against the built PWA in CI; it does not replace
  real-device testing, which remains a release-channel activity.
