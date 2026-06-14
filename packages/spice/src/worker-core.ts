// Reusable SPICE worker plumbing, independent of how the worker scope is created.
// worker.ts wires it to a plain module worker; bundler-specific shells (the Vite
// web app) wire it with a locateFile that points at the emitted cspice.wasm asset.

import { createSpiceEngine, type SpiceEngineOptions } from './engine.ts';
import type { SpiceEngine } from './index.ts';
import type { SpiceWorkerRequest, SpiceWorkerResponse } from './protocol.ts';

export interface SpiceWorkerScope {
  onmessage: ((ev: MessageEvent<SpiceWorkerRequest>) => void) | null;
  postMessage(message: SpiceWorkerResponse): void;
}

export async function dispatchSpice(engine: SpiceEngine, req: SpiceWorkerRequest): Promise<unknown> {
  switch (req.method) {
    case 'furnsh':
      return engine.furnsh(req.name, req.bytes);
    case 'unload':
      return engine.unload(req.name);
    case 'kclear':
      return engine.kclear();
    case 'ktotal':
      return engine.ktotal(req.kind);
    case 'str2et':
      return engine.str2et(req.utc);
    case 'et2utc':
      return engine.et2utc(req.et, req.format, req.precision);
    case 'utc2et':
      return engine.utc2et(req.utc);
    case 'spkpos':
      return engine.spkpos(req.target, req.et, req.frame, req.abcorr, req.observer);
    case 'spkezr':
      return engine.spkezr(req.target, req.et, req.frame, req.abcorr, req.observer);
    case 'getfov':
      return engine.getfov(req.instId, req.room);
    case 'bodvrd':
      return engine.bodvrd(req.body, req.item);
    case 'bodvcd':
      return engine.bodvcd(req.bodyId, req.item);
    case 'pxform':
      return engine.pxform(req.from, req.to, req.et);
    case 'sxform':
      return engine.sxform(req.from, req.to, req.et);
    case 'sincpt':
      return engine.sincpt(
        req.surfaceMethod,
        req.target,
        req.et,
        req.fixref,
        req.abcorr,
        req.observer,
        req.dref,
        req.dvec,
      );
    case 'subpnt':
      return engine.subpnt(
        req.surfaceMethod,
        req.target,
        req.et,
        req.fixref,
        req.abcorr,
        req.observer,
      );
    case 'ilumin':
      return engine.ilumin(
        req.surfaceMethod,
        req.target,
        req.et,
        req.fixref,
        req.abcorr,
        req.observer,
        req.point,
      );
    case 'readDsk':
      return engine.readDsk(req.name, req.bytes);
    case 'tkvrsn':
      return engine.tkvrsn();
  }
}

export function installSpiceWorker(scope: SpiceWorkerScope, options?: SpiceEngineOptions): void {
  let enginePromise: Promise<SpiceEngine> | null = null;
  const engine = (): Promise<SpiceEngine> => (enginePromise ??= createSpiceEngine(options));

  scope.onmessage = (ev) => {
    const req = ev.data;
    engine()
      .then((e) => dispatchSpice(e, req))
      .then(
        (result) => scope.postMessage({ id: req.id, ok: true, result }),
        (err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          const shortMessage =
            err && typeof err === 'object' && 'shortMessage' in err
              ? String((err as { shortMessage?: unknown }).shortMessage)
              : undefined;
          scope.postMessage({ id: req.id, ok: false, error, shortMessage });
        },
      );
  };
}
