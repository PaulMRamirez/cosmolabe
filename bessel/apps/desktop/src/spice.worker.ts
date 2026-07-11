// Vite-bundled SPICE worker for the desktop renderer. ?url makes electron-vite emit
// cspice.wasm and gives us its URL for locateFile.
import wasmUrl from 'cspice-wasm/wasm/cspice.wasm?url';
import { installSpiceWorker, type SpiceWorkerScope } from 'cspice-wasm/worker-core';

installSpiceWorker(self as unknown as SpiceWorkerScope, { locateFile: () => wasmUrl });
