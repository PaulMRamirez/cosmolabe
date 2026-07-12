# M-0004: AnalysisProduct schema, job protocol, authority field

Status: Accepted; amendment 1 attached 2026-07-11 (Session 10)
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10); amendment 1 by Paul Ramirez solo per the mandate
Review-on-return: yes; amendment 1 only (the field-domain generalization); the original decision stays as agreed 2026-07-09

## Context
Engine outputs need one shape across panel, app, SDK, and CLI, and the PlanDev source-of-truth rule needs enforcement stronger than convention. See docs/design/02 section 5.

## Decision
Every engine runs behind one typed job protocol (submit, progress with streaming partials, cancel). Products have exactly four kinds: intervals, series, geometry, field. Each product carries Provenance: engine and version, kernel set hash, frame and correction, authority, timestamp, job id. `authority: 'host'` is settable only by host data adapters; engines emit `'exploratory'`. Each kind has exactly one canonical visual form (M-0008).

## Consequences
New engines require zero renderer work. The UI provenance grammar and the CLI and SDK serialization all derive from this schema. Any output that does not fit the four kinds triggers a schema conversation, not a fifth kind by default.

## Amendment 1 (Session 10, 2026-07-11): the field domain generalizes

The schema conversation this ADR demands arrived with the porkchop inspector (M-0008 P1): a porkchop is grammatically a field (one scalar over a uniform 2D domain, rendered as the heatmap form) but its axes are departure epoch by time of flight, and stuffing epoch seconds into ScalarField's planetocentric lat/lon radians would have been a silent reinterpretation. The amendment: the field kind's payload becomes a discriminated union, Field = ScalarField | GridField. ScalarField (the body-surface drape) gains an optional discriminator, domain 'body', optional precisely so every pre-amendment producer and product remains valid unchanged; GridField carries domain 'grid' plus two named axes (FieldAxis: name, unit, min, max, count) and the same row-major values with the same NaN-is-unresolved convention. This is not a fifth kind: the canonical visual form (the M-0008 heatmap) is unchanged, and only the scene drape path is domain 'body' specific. The wire encoding gains the matching SerializedGridField; the api-surface snapshots moved in the same commit per the stability policy; the first grid producer is porkchopJob, whose delta-v surface streams one column partial at a time like the coverage sweep. Panel and demo renderers consume either domain through one cell layout. Intent recorded at the Session 10 pre-merge gate: the optional 'body' discriminator is a compatibility bridge, not the end state; the discriminator becomes required on both union members at the packages restructure (schema v1, when breaking is free), and the ledger carries that expiry.
