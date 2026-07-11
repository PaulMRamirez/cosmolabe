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
