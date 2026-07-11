// Vite asset-URL imports used by the worker entries (for example
// 'cspice-wasm/wasm/cspice.wasm?url', Session 4 re-point). Vite resolves the
// suffix at bundle time; this ambient declaration is what tsc sees.
declare module '*?url' {
  const url: string;
  export default url;
}
