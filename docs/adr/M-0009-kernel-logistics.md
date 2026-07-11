# M-0009: Kernel logistics

Status: Accepted
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: no; substance agreed 2026-07-09

## Context
"Everything in the browser, no server" is the right default and an incomplete answer; large kernels versus phone memory is a shipping constraint. See docs/design/02 section 6.

## Decision
Three pack classes: pack-min (LSK, PCK, a DE440 excerpt for the mission-relevant century; bundled with the iOS build as the offline floor), pack-system (per-system satellite ephemerides on demand), mission packs via a subsetter that starts as an offline CI tool wrapping the standard NAIF utilities before any service exists; the optional kernel proxy remains the online path for range-request segment fetching. OPFS cache with least-recently-furnished eviction budgeted per profile: 200 MB tier C, 1 GB tier B, effectively unbounded with eviction at tier A. Kernels never enter git; a checksummed fetch script serves dev and CI identically.

## Consequences
Tier C budgets are validated on device in W4, not estimated.
