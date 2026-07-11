// Vite-bundled SPICE worker for the web shell. Importing the wasm with ?url makes
// Vite emit cspice.wasm as a hashed asset and gives us its final URL, which we
// hand to the engine via locateFile so CSPICE fetches the right file at runtime.
import wasmUrl from '@bessel/spice/wasm/cspice.wasm?url';
import { installSpiceWorker, type SpiceWorkerScope } from '@bessel/spice/worker-core';

installSpiceWorker(self as unknown as SpiceWorkerScope, { locateFile: () => wasmUrl });
