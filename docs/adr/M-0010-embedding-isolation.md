# M-0010: Embedding isolation strategy and mount API

Status: Accepted
Date: 2026-07-10 | Deciders: Paul Ramirez; Aaron Plave by prior delegation (2026-07-10)
Review-on-return: no; substance agreed 2026-07-09

## Context
Threaded WASM wants SharedArrayBuffer; SharedArrayBuffer wants cross-origin isolation; isolation is viral into host applications. See docs/design/02 section 8.

## Decision
Isolation resolves in order: host serves COOP and COEP, run threaded; host accepts an iframe embed, run the panel in a credentialless-COEP iframe and regain threads; otherwise transferable-buffer fallback. The Companion defaults to fallback (M-0007). The entire host-facing surface of the decision is one field: `mount(node, { data, compute?: 'threads' | 'transfer' | 'iframe', profile? })`, probe-resolved when omitted. The compute plane is built to degrade gracefully, so engines never assume shared memory.

## Consequences
Host integration conversations (Aerie, MMGIS) start from a one-word choice rather than a security review surprise. The Aerie adapter beyond prototype is Class C, parked for joint execution.

## Observed host posture: MMGIS (Session 8, 2026-07-11)
Observed in the MMGIS source of truth (NASA-AMMOS/MMGIS at commit 44814b1, 2026-07-09, via the read-only reference copy scripts/fetch-mmgis-reference.sh maintains): the Express server's helmet configuration explicitly sets crossOriginEmbedderPolicy, crossOriginOpenerPolicy, and crossOriginResourcePolicy to false (scripts/server.js), so a stock MMGIS deployment is not cross-origin isolated and the isolation tree resolves to the transferable-buffer fallback: a real MMGIS host today gets the panel exactly as it ships ('transfer'). Two configuration facts refine the 'iframe' branch: the CSP frameSrc and frameAncestors directives default to 'none' but are environment-configurable (FRAME_SRC, FRAME_ANCESTORS), so an MMGIS deployment could permit hosting the panel in an iframe by configuration alone, no MMGIS code change; enabling COOP and COEP on MMGIS itself would instead be a helmet change in MMGIS's repository (behind the PlanDev-MMGIS sync) and is the only path to 'threads' inside an MMGIS page. This records observed source posture, not a live deployment measurement.
