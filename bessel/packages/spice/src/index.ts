// @bessel/spice: a compatibility facade. Session 3 extracted the CSPICE layer
// (typed full-surface wrapper, worker pool, zero-copy batch, the WASM artifacts,
// and the conformance tests) into the internally published cspice-wasm package
// (ADR M-0002, docs/goals/SESSION-3-SEAM.goal.md). Every bessel-heritage import
// of the bare specifier keeps working through this re-export; subpath consumers
// (the app spice workers, the CLI build) import cspice-wasm directly. New code
// should depend on cspice-wasm, or on the frames tier above it.
export * from 'cspice-wasm';
