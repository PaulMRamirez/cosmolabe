// The bare embed host behind the M-0007 smoke test: this page consumes
// @bessel/panel exactly as a third-party host would, supplying the things
// only a host's bundler can know (the worker construction, the wasm URL,
// the kernel asset URLs) and asking fallback compute for all four M-0004
// product kinds against the GS-2 era boot kernels. No workbench chrome, no
// store, no scene: if this page renders products, the panel is embeddable.

import { mount, type HostDataAdapter } from '@bessel/panel';
import cspiceWasmUrl from 'cspice-wasm/wasm/cspice.wasm?url';
import { KERNEL_ORDER, KERNEL_URLS } from './kernels.ts';

const HOUR = 3600;
const EPOCH = '2004-07-01T01:00:00';

const data: HostDataAdapter = {
  compute: {
    epoch: EPOCH,
    wasmUrl: cspiceWasmUrl,
    async kernels() {
      return Promise.all(
        KERNEL_ORDER.map(async (name) => {
          const res = await fetch(KERNEL_URLS[name]!);
          if (!res.ok) {
            throw new Error(`embed host: kernel fetch failed for ${name} (${res.status})`);
          }
          return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
        }),
      );
    },
    createWorker() {
      return new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    },
    jobs: [
      {
        label: 'Cassini and Sun access from Saturn',
        spec: (et0) => ({
          kind: 'access',
          request: {
            observer: 'SATURN',
            targets: ['CASSINI', 'SUN'],
            span: [et0, et0 + 4 * HOUR],
            step: HOUR,
            constraints: [{ kind: 'range', maxKm: 2.0e5 }],
            correction: 'NONE',
          },
        }),
      },
      {
        label: 'Saturn to Cassini range',
        spec: (et0) => ({
          kind: 'series',
          request: {
            providers: [{ kind: 'range', observer: 'SATURN', target: 'CASSINI' }],
            span: [et0, et0 + 4 * HOUR],
            step: 60,
            frame: 'J2000',
            correction: 'NONE',
            chunks: 4,
          },
        }),
      },
      {
        label: 'Cassini ground track over Saturn',
        spec: (et0) => ({
          kind: 'groundTrack',
          request: {
            body: 'SATURN',
            satellite: 'CASSINI',
            bodyFrame: 'IAU_SATURN',
            span: [et0, et0 + 4 * HOUR],
            step: 120,
            correction: 'NONE',
            chunks: 4,
          },
        }),
      },
      {
        label: 'Cassini visibility field over Saturn',
        spec: (et0) => ({
          kind: 'coverage',
          request: {
            grid: {
              body: 'SATURN',
              bodyFrame: 'IAU_SATURN',
              latMin: (-60 * Math.PI) / 180,
              latMax: (60 * Math.PI) / 180,
              latCount: 4,
              lonMin: -Math.PI,
              lonMax: Math.PI * (1 - 2 / 8),
              lonCount: 8,
              altKm: 0,
            },
            assets: ['CASSINI'],
            span: [et0, et0 + 2 * HOUR],
            step: 600,
            minElevationRad: 0,
            correction: 'NONE',
          },
        }),
      },
    ],
  },
};

const node = document.getElementById('panel-host');
if (!node) throw new Error('embed host: missing #panel-host');
mount(node, { data });
