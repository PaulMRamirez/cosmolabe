// @bessel/spice: a typed, promise-based API over CSPICE-WASM running in a Web
// Worker. Phase 0 implements the engine and the worker transport; this module
// is the public surface the renderer and geometry layers call.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StateVector {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly lightTime: number;
}

export interface PositionResult {
  readonly position: Vec3;
  readonly lightTime: number;
}

export type AberrationCorrection =
  | 'NONE'
  | 'LT'
  | 'LT+S'
  | 'CN'
  | 'CN+S'
  | 'XLT'
  | 'XLT+S'
  | 'XCN'
  | 'XCN+S';

/** The minimal SPICE surface the renderer needs (SPEC 5.1). */
export interface SpiceEngine {
  furnsh(name: string, bytes: Uint8Array): Promise<void>;
  unload(name: string): Promise<void>;
  kclear(): Promise<void>;
  ktotal(kind?: string): Promise<number>;

  str2et(utc: string): Promise<number>;
  et2utc(et: number, format: string, precision: number): Promise<string>;
  utc2et(utc: string): Promise<number>;

  spkpos(
    target: string,
    et: number,
    frame: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): Promise<PositionResult>;
  spkezr(
    target: string,
    et: number,
    frame: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): Promise<StateVector>;

  /** Instrument field of view: shape, frame, boresight, and boundary vectors. */
  getfov(instId: number, room?: number): Promise<FovResult>;
  bodvrd(body: string, item: string): Promise<number[]>;
  bodvcd(bodyId: number, item: string): Promise<number[]>;
  /** Rotation (row-major 3x3) from one frame to another at et. */
  pxform(from: string, to: string, et: number): Promise<Mat3>;
  /** State transformation (row-major 6x6) from one frame to another at et. */
  sxform(from: string, to: string, et: number): Promise<number[]>;
  /** Surface intercept of a ray (dvec in dref) from observer onto target. */
  sincpt(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
    dref: string,
    dvec: Vec3,
  ): Promise<InterceptResult>;
  /** Sub-observer point on target. */
  subpnt(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): Promise<SubPointResult>;

  /** Illumination angles (phase, incidence, emission) at a surface point. */
  ilumin(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
    point: Vec3,
  ): Promise<IluminResult>;

  /** Read a DSK type-2 shape model (vertices km, 0-based plate indices). */
  readDsk(name: string, bytes: Uint8Array): Promise<DskShape>;

  tkvrsn(): Promise<string>;
}

export interface IluminResult {
  /** Solar phase angle at the point, radians. */
  readonly phase: number;
  /** Solar incidence angle, radians. */
  readonly incidence: number;
  /** Emission angle to the observer, radians. */
  readonly emission: number;
  readonly trgepc: number;
  readonly srfvec: Vec3;
}

export interface DskShape {
  /** Flat vertex coordinates in km in the body-fixed frame, length 3 * nv. */
  readonly vertices: number[];
  /** Flat triangle vertex indices, 0-based, length 3 * np. */
  readonly plates: number[];
}

/** Row-major 3x3 rotation matrix. */
export type Mat3 = readonly number[];

export interface FovResult {
  readonly shape: string;
  readonly frame: string;
  readonly boresight: Vec3;
  readonly bounds: readonly Vec3[];
}

export interface InterceptResult {
  readonly found: boolean;
  readonly point: Vec3;
  readonly trgepc: number;
  readonly srfvec: Vec3;
}

export interface SubPointResult {
  readonly point: Vec3;
  readonly trgepc: number;
  readonly srfvec: Vec3;
}

/** Located, typed SPICE error. Fail loudly (CLAUDE.md). */
export class SpiceError extends Error {
  constructor(
    message: string,
    readonly shortMessage?: string,
  ) {
    super(message);
    this.name = 'SpiceError';
  }
}

export type { SpiceWorkerRequest, SpiceWorkerResponse } from './protocol.ts';
export { createSpiceEngine, type SpiceEngineOptions } from './engine.ts';
export { createSpiceWorkerClient } from './client.ts';
export { installSpiceWorker, dispatchSpice, type SpiceWorkerScope } from './worker-core.ts';
