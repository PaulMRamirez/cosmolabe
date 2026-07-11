# Contributing to Bessel

Thanks for your interest. Bessel is Apache-2.0. Contributions of code,
catalogs, mission plugins, documentation, and issue reports are all welcome.

## Ground rules

- Be respectful; see CODE_OF_CONDUCT.md.
- Every change goes through a pull request; main is protected.
- Sign your commits with the Developer Certificate of Origin
  (git commit -s). This certifies you have the right to contribute the change.
- Do not use em dashes anywhere in this repository (code, comments, docs,
  commits, UI copy). Use commas, colons, parentheses, or semicolons.

## Before you open a pull request

1. Read CLAUDE.md (the operating manual) and the relevant ADRs in docs/adr/.
   Architecture decisions change through an ADR, not through a side effect.
2. Run the gate locally: `pnpm verify` (typecheck, lint, test, build:web, size).
   CI runs the same commands; green locally means green in CI.
3. For UI changes, run `pnpm e2e` including the accessibility scan.
4. Add a changeset (`pnpm changeset`) describing the change for release notes.

## What reviewers check

- The dependency rule holds: core packages never import a concrete PAL
  implementation.
- No tests deleted, skipped, or weakened to pass; no new ts-ignore or
  eslint-disable without an inline justification.
- Failure modes are loud: errors are explicit, located, and typed.
- Performance budgets hold (.size-limit.json, lighthouserc.json).

## Mission plugins and catalogs

Mission-specific behavior belongs in a plugin (ADR-0007), not a fork. Catalog
schema changes are ADR-worthy; see docs/catalog-schema.md and ADR-0006.

## Reporting issues

Use the issue templates. For suspected security issues, do not open a public
issue; see SECURITY.md.
