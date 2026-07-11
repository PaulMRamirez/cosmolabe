# ADR-0008: AMMOS suite integration by URL contract, not embedding

Status: Accepted
Date: 2026-06-07

## Context

Bessel's program objective is to join the NASA-AMMOS product suite alongside
MMGIS (surface GIS). A suite member must interoperate with its peers without
coupling release cycles or codebases. Embedding one application inside another
creates exactly that coupling, plus version skew and styling drift. MMGIS
already publishes a deep-linking URL contract in its repository
(docs/pages/Miscellaneous/Deep_Linking/Deep_Linking.md), which is the natural
seam.

## Decision

Bessel integrates with MMGIS through stable, versioned URL contracts:

1. The Bessel view URL: every view is fully reconstructable from a URL
   (epoch, camera, selection, visibility, plugins). MMGIS links to Bessel by
   constructing this URL, which requires only MMGIS configuration, not MMGIS
   code changes.
2. Outbound deep links: Bessel constructs MMGIS URLs using the deep-linking
   parameters MMGIS already supports (mission, mapLon, mapLat, mapZoom,
   centerPin, startTime, endTime, and optionally selected and on), for
   orbital-to-surface handoff. The parameter usage is recorded in
   docs/integrations.md, derived from the MMGIS repository, which remains the
   source of truth; scripts/fetch-mmgis-reference.sh maintains a local
   read-only reference copy for inspection during goal sessions.
3. CZML export for CesiumJS-based contexts, as interchange rather than live
   link.

The catalog schema additionally carries an optional observation products
linkage ({ id, type, href? }) so observations can reference the image or data
products they produced, for downstream viewers and archives (ADR-0006).

Once shipped in Phase 2, the contracts are public API: versioned, integration
tested in the unit and e2e suites, and ADR-worthy to change.

## Consequences

- Bessel and MMGIS ship on independent cadences; integration survives redesigns
  on either side because only the URL contract is shared.
- The two handoffs (Bessel to MMGIS, MMGIS to Bessel) each answer a real
  operations question in one click.
- If the MMGIS deep-linking contract evolves, docs/integrations.md is updated
  against the MMGIS repository and the local reference copy is refreshed.
- No suite peer is embedded, so Bessel carries no dependency on peer internals.
