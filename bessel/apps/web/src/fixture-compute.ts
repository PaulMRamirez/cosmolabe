// The fixture compute adapter shared by the bare embed host and the
// MMGIS-shaped fixture host: the host-side supplies of M-0007's fallback
// compute (kernel bytes by URL, worker construction, the wasm asset URL),
// which stay with the host because only its bundler can resolve them. Jobs
// are the per-host part and come in from each host page.

import type { HostComputeAdapter, PanelJob } from '@bessel/panel';
import cspiceWasmUrl from 'cspice-wasm/wasm/cspice.wasm?url';
import { KERNEL_ORDER, KERNEL_URLS } from './kernels.ts';

export const FIXTURE_EPOCH = '2004-07-01T01:00:00';

export function fixtureComputeAdapter(jobs: readonly PanelJob[]): HostComputeAdapter {
  return {
    epoch: FIXTURE_EPOCH,
    wasmUrl: cspiceWasmUrl,
    async kernels() {
      return Promise.all(
        KERNEL_ORDER.map(async (name) => {
          const res = await fetch(KERNEL_URLS[name]!);
          if (!res.ok) {
            throw new Error(`fixture host: kernel fetch failed for ${name} (${res.status})`);
          }
          return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
        }),
      );
    },
    createWorker() {
      return new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    },
    jobs,
  };
}
