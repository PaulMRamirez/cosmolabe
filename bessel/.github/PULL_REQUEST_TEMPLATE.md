## What and why

(Describe the change and the motivation. Link issues.)

## Checklist

- [ ] `pnpm verify` passes locally (typecheck, lint, test, build:web, size)
- [ ] No tests deleted, skipped, or weakened; no new ts-ignore or eslint-disable
      without inline justification
- [ ] Dependency rule holds (core never imports a concrete PAL implementation)
- [ ] Changeset added (`pnpm changeset`) if user-visible
- [ ] No em dashes anywhere in the diff
- [ ] ADR added or updated if this changes an architecture decision
