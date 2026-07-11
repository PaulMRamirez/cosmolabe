# M-0004: AnalysisProduct schema, job protocol, authority field

Status: Accepted
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: no; substance agreed 2026-07-09

## Context
Engine outputs need one shape across panel, app, SDK, and CLI, and the PlanDev source-of-truth rule needs enforcement stronger than convention. See docs/design/02 section 5.

## Decision
Every engine runs behind one typed job protocol (submit, progress with streaming partials, cancel). Products have exactly four kinds: intervals, series, geometry, field. Each product carries Provenance: engine and version, kernel set hash, frame and correction, authority, timestamp, job id. `authority: 'host'` is settable only by host data adapters; engines emit `'exploratory'`. Each kind has exactly one canonical visual form (M-0008).

## Consequences
New engines require zero renderer work. The UI provenance grammar and the CLI and SDK serialization all derive from this schema. Any output that does not fit the four kinds triggers a schema conversation, not a fifth kind by default.
