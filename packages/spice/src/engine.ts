// In-process SPICE engine: loads CSPICE-WASM directly (no worker) and implements
// the SpiceEngine surface. Used by unit tests and by the worker entry point. The
// browser uses createSpiceWorkerClient (client.ts) to keep furnsh and geometry
// off the main thread; both paths share these bindings.

import CSpice from '@bessel/spice/wasm/cspice.mjs';
import { SpiceBindings } from './bindings.ts';
import type { AberrationCorrection, SpiceEngine } from './index.ts';

export interface SpiceEngineOptions {
  /** Resolve the cspice.wasm URL. Bundlers (Vite) pass the emitted asset URL. */
  locateFile?: (path: string) => string;
}

export async function createSpiceEngine(options?: SpiceEngineOptions): Promise<SpiceEngine> {
  const mod = await CSpice(options?.locateFile ? { locateFile: options.locateFile } : undefined);
  const bindings = new SpiceBindings(mod);

  return {
    async furnsh(name, bytes) {
      bindings.furnsh(name, bytes);
    },
    async unload(name) {
      bindings.unload(name);
    },
    async kclear() {
      bindings.kclear();
    },
    async ktotal(kind) {
      return bindings.ktotal(kind);
    },
    async str2et(utc) {
      return bindings.str2et(utc);
    },
    async et2utc(et, format, precision) {
      return bindings.et2utc(et, format, precision);
    },
    async utc2et(utc) {
      return bindings.utc2et(utc);
    },
    async spkpos(target, et, frame, abcorr: AberrationCorrection, observer) {
      return bindings.spkpos(target, et, frame, abcorr, observer);
    },
    async spkezr(target, et, frame, abcorr: AberrationCorrection, observer) {
      return bindings.spkezr(target, et, frame, abcorr, observer);
    },
    async getfov(instId, room) {
      return bindings.getfov(instId, room);
    },
    async bodvrd(body, item) {
      return bindings.bodvrd(body, item);
    },
    async bodvcd(bodyId, item) {
      return bindings.bodvcd(bodyId, item);
    },
    async pxform(from, to, et) {
      return bindings.pxform(from, to, et);
    },
    async sxform(from, to, et) {
      return bindings.sxform(from, to, et);
    },
    async sincpt(method, target, et, fixref, abcorr: AberrationCorrection, observer, dref, dvec) {
      return bindings.sincpt(method, target, et, fixref, abcorr, observer, dref, dvec);
    },
    async subpnt(method, target, et, fixref, abcorr: AberrationCorrection, observer) {
      return bindings.subpnt(method, target, et, fixref, abcorr, observer);
    },
    async ilumin(method, target, et, fixref, abcorr: AberrationCorrection, observer, point) {
      return bindings.ilumin(method, target, et, fixref, abcorr, observer, point);
    },
    async readDsk(name, bytes) {
      return bindings.readDsk(name, bytes);
    },
    async tkvrsn() {
      return bindings.tkvrsn();
    },
  };
}
