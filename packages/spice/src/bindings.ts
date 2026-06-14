// Low-level marshaling over the CSPICE-WASM module. Owns pointer lifetimes and
// the per-function calling contract. Kernel bytes are written into the Emscripten
// in-memory FS and furnsh'd by path: the engine never parses kernels itself, it
// hands paths to CSPICE, satisfying "the SPICE engine never reads kernel bytes
// directly" (the bytes arrive via the PAL, are staged here, then loaded by CSPICE).

import type { CSpiceModule } from '@bessel/spice/wasm/cspice.mjs';
import {
  SpiceError,
  type AberrationCorrection,
  type DskShape,
  type FovResult,
  type IluminResult,
  type InterceptResult,
  type PositionResult,
  type StateVector,
  type SubPointResult,
  type Vec3,
} from './index.ts';

const KERNEL_DIR = '/kernels';

export class SpiceBindings {
  constructor(private readonly mod: CSpiceModule) {
    // Route SPICE errors to return-mode so failures surface as typed errors
    // rather than aborting the WASM runtime.
    this.call('erract_c', this.str('SET'), 0, this.str('RETURN'));
    this.call('errprt_c', this.str('SET'), 0, this.str('NONE'));
    if (!this.mod.FS.analyzePath(KERNEL_DIR).exists) this.mod.FS.mkdir(KERNEL_DIR);
  }

  private call(name: string, ...args: number[]): number {
    const fn = this.mod[`_${name}`];
    if (!fn) throw new SpiceError(`CSPICE export _${name} is not present in the build`);
    return fn(...args);
  }

  /** Allocate a NUL-terminated C string; caller frees via the scope helper. */
  private str(s: string): number {
    const n = this.mod.lengthBytesUTF8(s) + 1;
    const ptr = this.mod._malloc(n);
    this.mod.stringToUTF8(s, ptr, n);
    return ptr;
  }

  private readDouble(ptr: number): number {
    return this.mod.getValue(ptr, 'double');
  }

  private readInt(ptr: number): number {
    return this.mod.getValue(ptr, 'i32');
  }

  /** Throw a typed SpiceError if the last SPICE call failed; reset the engine. */
  private checkFailed(): void {
    if (this.call('failed_c') === 0) return;
    const shortPtr = this.mod._malloc(64);
    const longPtr = this.mod._malloc(1841);
    this.call('getmsg_c', this.str('SHORT'), 64, shortPtr);
    this.call('getmsg_c', this.str('LONG'), 1841, longPtr);
    const short = this.mod.UTF8ToString(shortPtr);
    const long = this.mod.UTF8ToString(longPtr);
    this.mod._free(shortPtr);
    this.mod._free(longPtr);
    this.call('reset_c');
    throw new SpiceError(long || short || 'SPICE call failed', short || undefined);
  }

  tkvrsn(): string {
    const ptr = this.call('tkvrsn_c', this.str('TOOLKIT'));
    return this.mod.UTF8ToString(ptr);
  }

  furnsh(name: string, bytes: Uint8Array): void {
    const path = `${KERNEL_DIR}/${name}`;
    this.mod.FS.writeFile(path, bytes);
    this.call('furnsh_c', this.str(path));
    this.checkFailed();
  }

  unload(name: string): void {
    const path = `${KERNEL_DIR}/${name}`;
    this.call('unload_c', this.str(path));
    this.checkFailed();
    if (this.mod.FS.analyzePath(path).exists) this.mod.FS.unlink(path);
  }

  kclear(): void {
    this.call('kclear_c');
    this.checkFailed();
  }

  ktotal(kind = 'ALL'): number {
    const out = this.mod._malloc(4);
    this.call('ktotal_c', this.str(kind), out);
    this.checkFailed();
    const n = this.readInt(out);
    this.mod._free(out);
    return n;
  }

  str2et(utc: string): number {
    const out = this.mod._malloc(8);
    this.call('str2et_c', this.str(utc), out);
    this.checkFailed();
    const et = this.readDouble(out);
    this.mod._free(out);
    return et;
  }

  utc2et(utc: string): number {
    const out = this.mod._malloc(8);
    this.call('utc2et_c', this.str(utc), out);
    this.checkFailed();
    const et = this.readDouble(out);
    this.mod._free(out);
    return et;
  }

  et2utc(et: number, format: string, precision: number): string {
    const len = 64;
    const out = this.mod._malloc(len);
    this.call('et2utc_c', et, this.str(format), precision, len, out);
    this.checkFailed();
    return this.mod.UTF8ToString(out);
  }

  spkpos(
    target: string,
    et: number,
    frame: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): PositionResult {
    const pos = this.mod._malloc(3 * 8);
    const lt = this.mod._malloc(8);
    this.call(
      'spkpos_c',
      this.str(target),
      et,
      this.str(frame),
      this.str(abcorr),
      this.str(observer),
      pos,
      lt,
    );
    this.checkFailed();
    const result: PositionResult = {
      position: {
        x: this.readDouble(pos),
        y: this.readDouble(pos + 8),
        z: this.readDouble(pos + 16),
      },
      lightTime: this.readDouble(lt),
    };
    this.mod._free(pos);
    this.mod._free(lt);
    return result;
  }

  spkezr(
    target: string,
    et: number,
    frame: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): StateVector {
    const state = this.mod._malloc(6 * 8);
    const lt = this.mod._malloc(8);
    this.call(
      'spkezr_c',
      this.str(target),
      et,
      this.str(frame),
      this.str(abcorr),
      this.str(observer),
      state,
      lt,
    );
    this.checkFailed();
    const result: StateVector = {
      position: {
        x: this.readDouble(state),
        y: this.readDouble(state + 8),
        z: this.readDouble(state + 16),
      },
      velocity: {
        x: this.readDouble(state + 24),
        y: this.readDouble(state + 32),
        z: this.readDouble(state + 40),
      },
      lightTime: this.readDouble(lt),
    };
    this.mod._free(state);
    this.mod._free(lt);
    return result;
  }

  private readVec3(ptr: number): Vec3 {
    return { x: this.readDouble(ptr), y: this.readDouble(ptr + 8), z: this.readDouble(ptr + 16) };
  }

  getfov(instId: number, room = 16): FovResult {
    const shapeLen = 64;
    const frameLen = 64;
    const shape = this.mod._malloc(shapeLen);
    const frame = this.mod._malloc(frameLen);
    const bsight = this.mod._malloc(24);
    const nPtr = this.mod._malloc(4);
    const bounds = this.mod._malloc(room * 24);
    this.call('getfov_c', instId, room, shapeLen, frameLen, shape, frame, bsight, nPtr, bounds);
    this.checkFailed();
    const n = this.readInt(nPtr);
    const boundsArr: Vec3[] = [];
    for (let i = 0; i < n; i++) boundsArr.push(this.readVec3(bounds + i * 24));
    const result: FovResult = {
      shape: this.mod.UTF8ToString(shape),
      frame: this.mod.UTF8ToString(frame),
      boresight: this.readVec3(bsight),
      bounds: boundsArr,
    };
    [shape, frame, bsight, nPtr, bounds].forEach((p) => this.mod._free(p));
    return result;
  }

  private readDoubles(item: string, dim: number, fill: (valuesPtr: number, dimPtr: number) => void): number[] {
    const maxn = Math.max(1, dim);
    const dimPtr = this.mod._malloc(4);
    const values = this.mod._malloc(maxn * 8);
    fill(values, dimPtr);
    this.checkFailed();
    const out: number[] = [];
    const got = this.readInt(dimPtr);
    for (let i = 0; i < got; i++) out.push(this.readDouble(values + i * 8));
    this.mod._free(dimPtr);
    this.mod._free(values);
    return out;
  }

  bodvrd(body: string, item: string, maxn = 3): number[] {
    return this.readDoubles(item, maxn, (values, dimPtr) =>
      this.call('bodvrd_c', this.str(body), this.str(item), maxn, dimPtr, values),
    );
  }

  bodvcd(bodyId: number, item: string, maxn = 3): number[] {
    return this.readDoubles(item, maxn, (values, dimPtr) =>
      this.call('bodvcd_c', bodyId, this.str(item), maxn, dimPtr, values),
    );
  }

  pxform(from: string, to: string, et: number): number[] {
    const rot = this.mod._malloc(9 * 8);
    this.call('pxform_c', this.str(from), this.str(to), et, rot);
    this.checkFailed();
    const out: number[] = [];
    for (let i = 0; i < 9; i++) out.push(this.readDouble(rot + i * 8));
    this.mod._free(rot);
    return out;
  }

  sxform(from: string, to: string, et: number): number[] {
    const xf = this.mod._malloc(36 * 8);
    this.call('sxform_c', this.str(from), this.str(to), et, xf);
    this.checkFailed();
    const out: number[] = [];
    for (let i = 0; i < 36; i++) out.push(this.readDouble(xf + i * 8));
    this.mod._free(xf);
    return out;
  }

  sincpt(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
    dref: string,
    dvec: Vec3,
  ): InterceptResult {
    const dvecPtr = this.mod._malloc(24);
    this.mod.setValue(dvecPtr, dvec.x, 'double');
    this.mod.setValue(dvecPtr + 8, dvec.y, 'double');
    this.mod.setValue(dvecPtr + 16, dvec.z, 'double');
    const spoint = this.mod._malloc(24);
    const trgepc = this.mod._malloc(8);
    const srfvec = this.mod._malloc(24);
    const found = this.mod._malloc(4);
    this.call(
      'sincpt_c',
      this.str(method),
      this.str(target),
      et,
      this.str(fixref),
      this.str(abcorr),
      this.str(observer),
      this.str(dref),
      dvecPtr,
      spoint,
      trgepc,
      srfvec,
      found,
    );
    this.checkFailed();
    const result: InterceptResult = {
      found: this.readInt(found) !== 0,
      point: this.readVec3(spoint),
      trgepc: this.readDouble(trgepc),
      srfvec: this.readVec3(srfvec),
    };
    [dvecPtr, spoint, trgepc, srfvec, found].forEach((p) => this.mod._free(p));
    return result;
  }

  ilumin(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
    point: Vec3,
  ): IluminResult {
    const spoint = this.mod._malloc(24);
    this.mod.setValue(spoint, point.x, 'double');
    this.mod.setValue(spoint + 8, point.y, 'double');
    this.mod.setValue(spoint + 16, point.z, 'double');
    const trgepc = this.mod._malloc(8);
    const srfvec = this.mod._malloc(24);
    const phase = this.mod._malloc(8);
    const incdnc = this.mod._malloc(8);
    const emissn = this.mod._malloc(8);
    this.call(
      'ilumin_c',
      this.str(method),
      this.str(target),
      et,
      this.str(fixref),
      this.str(abcorr),
      this.str(observer),
      spoint,
      trgepc,
      srfvec,
      phase,
      incdnc,
      emissn,
    );
    this.checkFailed();
    const result: IluminResult = {
      phase: this.readDouble(phase),
      incidence: this.readDouble(incdnc),
      emission: this.readDouble(emissn),
      trgepc: this.readDouble(trgepc),
      srfvec: this.readVec3(srfvec),
    };
    [spoint, trgepc, srfvec, phase, incdnc, emissn].forEach((p) => this.mod._free(p));
    return result;
  }

  /** Read a DSK type-2 shape model by staging bytes and using DAS-level readers. */
  readDsk(name: string, bytes: Uint8Array): DskShape {
    const path = `${KERNEL_DIR}/${name}`;
    this.mod.FS.writeFile(path, bytes);
    const handlePtr = this.mod._malloc(4);
    this.call('dasopr_c', this.str(path), handlePtr);
    this.checkFailed();
    const handle = this.readInt(handlePtr);

    const descr = this.mod._malloc(8 * 4); // SpiceDLADescr: 8 ints
    const found = this.mod._malloc(4);
    this.call('dlabfs_c', handle, descr, found);
    this.checkFailed();
    if (this.readInt(found) === 0) {
      this.call('dascls_c', handle);
      throw new SpiceError(`DSK "${name}" has no segments`);
    }

    const nvPtr = this.mod._malloc(4);
    const npPtr = this.mod._malloc(4);
    this.call('dskz02_c', handle, descr, nvPtr, npPtr);
    this.checkFailed();
    const nv = this.readInt(nvPtr);
    const np = this.readInt(npPtr);

    const vertices = this.readDskChunked(nv, 3, 8, (start, room, nPtr, buf) =>
      this.call('dskv02_c', handle, descr, start, room, nPtr, buf),
    );
    const platesRaw = this.readDskChunked(np, 3, 4, (start, room, nPtr, buf) =>
      this.call('dskp02_c', handle, descr, start, room, nPtr, buf),
    );

    this.call('dascls_c', handle);
    this.checkFailed();
    [handlePtr, descr, found, nvPtr, npPtr].forEach((p) => this.mod._free(p));

    // Plate vertex indices are 1-based in CSPICE; convert to 0-based.
    const plates = platesRaw.map((i) => i - 1);
    return { vertices, plates };
  }

  /** Read count rows of `cols` values (`bytes` each: 8 double, 4 int) in chunks. */
  private readDskChunked(
    count: number,
    cols: number,
    bytes: number,
    fetch: (start: number, room: number, nPtr: number, buf: number) => number,
  ): number[] {
    const CHUNK = 1000;
    const nPtr = this.mod._malloc(4);
    const buf = this.mod._malloc(CHUNK * cols * bytes);
    const out: number[] = [];
    const isDouble = bytes === 8;
    let start = 1;
    while (start <= count) {
      const room = Math.min(CHUNK, count - start + 1);
      fetch(start, room, nPtr, buf);
      this.checkFailed();
      const n = this.readInt(nPtr);
      if (n <= 0) break;
      for (let i = 0; i < n * cols; i++) {
        out.push(isDouble ? this.readDouble(buf + i * 8) : this.readInt(buf + i * 4));
      }
      start += n;
    }
    this.mod._free(nPtr);
    this.mod._free(buf);
    return out;
  }

  subpnt(
    method: string,
    target: string,
    et: number,
    fixref: string,
    abcorr: AberrationCorrection,
    observer: string,
  ): SubPointResult {
    const spoint = this.mod._malloc(24);
    const trgepc = this.mod._malloc(8);
    const srfvec = this.mod._malloc(24);
    this.call(
      'subpnt_c',
      this.str(method),
      this.str(target),
      et,
      this.str(fixref),
      this.str(abcorr),
      this.str(observer),
      spoint,
      trgepc,
      srfvec,
    );
    this.checkFailed();
    const result: SubPointResult = {
      point: this.readVec3(spoint),
      trgepc: this.readDouble(trgepc),
      srfvec: this.readVec3(srfvec),
    };
    [spoint, trgepc, srfvec].forEach((p) => this.mod._free(p));
    return result;
  }
}
