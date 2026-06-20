// Camera kinematics with smooth damping, fly-to transitions, and several modes
// (orbit, track, sync, free). Pure of three.js so the math is unit tested; the
// scene reads the composed pose each frame and applies it to the PerspectiveCamera.
//
// Distances are SCENE UNITS (km * SCALE). The view "center" is in km: the scene
// shifts the world by -center so the focus sits near the origin (float32 safe).

import {
  computeOrbitCameraPosition,
  computeTrackCameraPosition,
  dollyFactor,
} from './camera-modes.ts';
import { type Km3 } from './geometry-builders.ts';

// 'frame' locks the orbit basis to an arbitrary SPICE reference frame (any
// frame->J2000 rotation), generalizing 'sync' (which is specifically the body's
// IAU body-fixed frame). Both feed a rotation into orbitPose the same way.
export type CameraControlMode = 'orbit' | 'track' | 'sync' | 'free' | 'frame';

const RESPONSIVE = 0.1; // smoothTime (s) for direct input (drag, wheel)
const TRANSITION = 0.5; // smoothTime (s) for animated view changes
const FLY_DURATION = 0.7; // seconds to glide the view center between bodies
const ELEV_LIMIT = Math.PI / 2 - 0.02;
const MIN_DIST = 5e-4; // 500 km in scene units; pairs with a small near plane
const MAX_DIST = 5e7;
const MIN_FOV = 12;
const MAX_FOV = 70;
const TWO_PI = Math.PI * 2;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Critically-damped approach toward a target (Game Programming Gems / Unity). */
export function smoothDamp(
  current: number,
  target: number,
  vel: { v: number },
  smoothTime: number,
  dt: number,
): number {
  if (dt <= 0) return current;
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  // Prevent overshoot past the target.
  if (target - current > 0 === output > target) {
    output = target;
    vel.v = (output - target) / dt;
  }
  return output;
}

/** Unwrap b to the value congruent mod 2pi nearest to a (shortest angular path). */
export function nearestAngle(a: number, b: number): number {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d;
}

/** A single damped scalar channel (value chases target with per-channel velocity). */
class Channel {
  value: number;
  target: number;
  v = 0;
  smooth: number;
  constructor(initial: number, smooth = RESPONSIVE) {
    this.value = initial;
    this.target = initial;
    this.smooth = smooth;
  }
  set(target: number, smooth = RESPONSIVE): void {
    this.target = target;
    this.smooth = smooth;
  }
  snap(target: number): void {
    this.value = target;
    this.target = target;
    this.v = 0;
  }
  step(dt: number): void {
    this.value = smoothDamp(this.value, this.target, this, this.smooth, dt);
  }
}

/** Distance (scene units) framing a sphere of the given radius at a field of view. */
export function framingDistance(radiusUnits: number, fovDeg: number, margin = 2.6): number {
  const half = (fovDeg * Math.PI) / 180 / 2;
  const d = (radiusUnits / Math.max(1e-6, Math.tan(half))) * margin;
  return clamp(d, MIN_DIST, MAX_DIST);
}

const mat3xVec = (m: readonly number[], v: readonly [number, number, number]): [number, number, number] => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
  m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];

export interface CameraStepInput {
  readonly dt: number;
  /** Live focus position in km (the body the view is centered on). */
  readonly focusPos: Km3;
  /** Focus velocity (km/s) for track mode. */
  readonly focusVelocity?: Km3;
  /** Body-fixed -> J2000 rotation (3x3 row-major) for sync mode. */
  readonly bodyFrame?: readonly number[];
}

export interface CameraPose {
  /** View center in km (world is shifted by -center). */
  readonly center: Km3;
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly up: [number, number, number];
  readonly fov: number;
}

/**
 * Owns the camera's animated state. Orbit/sync/track/free modes all reduce to a
 * position, look-at target, up vector, and FOV in scene units relative to the
 * damped view center, composed once per frame in step().
 */
export class CameraController {
  mode: CameraControlMode = 'orbit';
  private readonly azimuth = new Channel(0.6);
  private readonly elevation = new Channel(0.35);
  private readonly logDist = new Channel(Math.log(3000));
  private readonly fov = new Channel(45);
  private readonly roll = new Channel(0);
  private readonly panX = new Channel(0); // screen-plane offset, fraction of distance
  private readonly panY = new Channel(0);

  private center: [number, number, number] = [0, 0, 0];
  private flyStart: [number, number, number] = [0, 0, 0];
  private flyElapsed = FLY_DURATION;
  private centerReady = false;

  // Free-fly state: position is scene units relative to the frozen center.
  private freePos: [number, number, number] = [0, 0, 0];
  private freeYaw = 0;
  private freePitch = 0;

  get distance(): number {
    return Math.exp(this.logDist.value);
  }
  get azimuthValue(): number {
    return this.azimuth.value;
  }
  get elevationValue(): number {
    return this.elevation.value;
  }
  get fovValue(): number {
    return this.fov.value;
  }
  /** Distance (scene units) of the free-fly camera from the view center. */
  get freeRadius(): number {
    return Math.hypot(this.freePos[0], this.freePos[1], this.freePos[2]);
  }

  orbitBy(dAzimuth: number, dElevation: number): void {
    if (this.mode === 'free') {
      this.freeYaw -= dAzimuth;
      this.freePitch = clamp(this.freePitch - dElevation, -ELEV_LIMIT, ELEV_LIMIT);
      return;
    }
    this.azimuth.set(this.azimuth.target + dAzimuth, RESPONSIVE);
    this.elevation.set(clamp(this.elevation.target + dElevation, -ELEV_LIMIT, ELEV_LIMIT), RESPONSIVE);
  }

  zoomBy(factor: number): void {
    const d = clamp(Math.exp(this.logDist.target) * factor, MIN_DIST, MAX_DIST);
    this.logDist.set(Math.log(d), RESPONSIVE);
  }

  panBy(dxFraction: number, dyFraction: number): void {
    this.panX.set(clamp(this.panX.target + dxFraction, -4, 4), RESPONSIVE);
    this.panY.set(clamp(this.panY.target + dyFraction, -4, 4), RESPONSIVE);
  }

  /**
   * Dolly (Cosmographia dollyForward / dollyBackward): translate the camera along
   * its view axis. forward > 0 approaches the focus, forward < 0 recedes. In the
   * orbit model this is a distance change, distinct from fovBy (a lens change).
   * In free-fly it moves the free camera straight along its own forward axis.
   */
  dollyBy(forwardFraction: number): void {
    if (this.mode === 'free') {
      this.flyMove(this.freeRadius * forwardFraction, 0, 0);
      return;
    }
    this.zoomBy(dollyFactor(forwardFraction));
  }

  /**
   * Crane (Cosmographia craneUp / craneDown): a vertical screen-plane translation
   * of the viewpoint. up > 0 raises the camera. In free-fly it moves the free
   * camera along world +Y.
   */
  craneBy(upFraction: number): void {
    if (this.mode === 'free') {
      this.flyMove(0, 0, this.freeRadius * upFraction);
      return;
    }
    this.panY.set(clamp(this.panY.target + upFraction, -4, 4), RESPONSIVE);
  }

  rollBy(dRoll: number): void {
    this.roll.set(this.roll.target + dRoll, RESPONSIVE);
  }

  fovBy(factor: number): void {
    this.fov.set(clamp(this.fov.target * factor, MIN_FOV, MAX_FOV), RESPONSIVE);
  }

  /** Translate the free-fly camera along its own axes (scene units). */
  flyMove(forward: number, right: number, up: number): void {
    const cp = Math.cos(this.freePitch);
    const sp = Math.sin(this.freePitch);
    const cy = Math.cos(this.freeYaw);
    const sy = Math.sin(this.freeYaw);
    const fwd: [number, number, number] = [cp * cy, sp, cp * sy];
    const rt: [number, number, number] = [-sy, 0, cy];
    this.freePos[0] += fwd[0] * forward + rt[0] * right;
    this.freePos[1] += fwd[1] * forward + rt[1] * right + up;
    this.freePos[2] += fwd[2] * forward + rt[2] * right;
  }

  setView(azimuth: number, elevation: number, distance: number, animate = false): void {
    const el = clamp(elevation, -ELEV_LIMIT, ELEV_LIMIT);
    const ld = Math.log(clamp(distance, MIN_DIST, MAX_DIST));
    if (animate) {
      this.azimuth.set(nearestAngle(this.azimuth.value, azimuth), TRANSITION);
      this.elevation.set(el, TRANSITION);
      this.logDist.set(ld, TRANSITION);
    } else {
      this.azimuth.snap(azimuth);
      this.elevation.snap(el);
      this.logDist.snap(ld);
    }
    // A framed view is centered and level: clear any pan and roll so re-centering
    // or a preset always returns to an upright, on-target camera.
    if (animate) {
      this.panX.set(0, TRANSITION);
      this.panY.set(0, TRANSITION);
      this.roll.set(0, TRANSITION);
    } else {
      this.panX.snap(0);
      this.panY.snap(0);
      this.roll.snap(0);
    }
  }

  setFovDeg(fovDeg: number, animate = false): void {
    const f = clamp(fovDeg, MIN_FOV, MAX_FOV);
    if (animate) this.fov.set(f, TRANSITION);
    else this.fov.snap(f);
  }

  setMode(mode: CameraControlMode): void {
    if (mode === this.mode) return;
    // Track is a transient override of the base mode: entering or leaving it must
    // not reseed or convert the free-fly pose, so free survives a track on/off.
    if (mode === 'free' && this.mode !== 'track') {
      // Seed the free camera from the current orbit pose so it does not jump.
      this.freePos = computeOrbitCameraPosition(this.azimuth.value, this.elevation.value, this.distance);
      this.freeYaw = Math.atan2(-this.freePos[2], -this.freePos[0]);
      this.freePitch = Math.asin(clamp(-this.freePos[1] / (this.distance || 1), -1, 1));
    } else if (this.mode === 'free' && mode !== 'track') {
      // Resume orbit/sync from the current free position (now looking at center),
      // so leaving free-fly does not snap back to the pre-free pose.
      const d = this.freeRadius || this.distance;
      this.logDist.snap(Math.log(clamp(d, MIN_DIST, MAX_DIST)));
      this.azimuth.snap(Math.atan2(this.freePos[2], this.freePos[0]));
      this.elevation.snap(Math.asin(clamp(this.freePos[1] / d, -1, 1)));
    }
    if (mode === 'track' || mode === 'free') {
      // Pan and roll are not expressed in these modes; clear them so they neither
      // accumulate invisibly nor snap back on return to orbit.
      this.panX.snap(0);
      this.panY.snap(0);
      this.roll.snap(0);
    }
    this.mode = mode;
  }

  /** Begin a glide of the view center to a (possibly different) focus body. */
  flyTo(): void {
    this.flyStart = [...this.center] as [number, number, number];
    this.flyElapsed = 0;
  }

  /** Snap the view center to the focus immediately (scene (re)build / boot). */
  snapCenter(focusPos: Km3): void {
    this.center = [focusPos[0], focusPos[1], focusPos[2]];
    this.flyElapsed = FLY_DURATION;
    this.centerReady = true;
  }

  step(input: CameraStepInput): CameraPose {
    const { dt, focusPos } = input;
    this.advanceCenter(dt, focusPos);
    this.azimuth.step(dt);
    this.elevation.step(dt);
    this.logDist.step(dt);
    this.fov.step(dt);
    this.roll.step(dt);
    this.panX.step(dt);
    this.panY.step(dt);

    const fov = this.fov.value;
    const center: Km3 = [this.center[0], this.center[1], this.center[2]];
    if (this.mode === 'free') return this.freePose(center, fov);
    if (this.mode === 'track') {
      const pos = computeTrackCameraPosition(input.focusVelocity ?? [0, 0, 0], this.distance);
      // Adaptive up: when the camera sits nearly over a pole (position parallel to
      // +Y) the default up is degenerate, so fall back to +Z for a stable basis.
      const pm = Math.hypot(pos[0], pos[1], pos[2]) || 1;
      const up: [number, number, number] = Math.abs(pos[1] / pm) > 0.99 ? [0, 0, 1] : [0, 1, 0];
      return { center, position: pos, target: [0, 0, 0], up, fov };
    }
    return this.orbitPose(center, fov, input.bodyFrame);
  }

  private advanceCenter(dt: number, focusPos: Km3): void {
    if (!this.centerReady) {
      this.snapCenter(focusPos);
      return;
    }
    if (this.flyElapsed < FLY_DURATION) {
      this.flyElapsed = Math.min(FLY_DURATION, this.flyElapsed + dt);
      const t = this.flyElapsed / FLY_DURATION;
      const e = t * t * (3 - 2 * t); // smoothstep ease
      this.center[0] = this.flyStart[0] + (focusPos[0] - this.flyStart[0]) * e;
      this.center[1] = this.flyStart[1] + (focusPos[1] - this.flyStart[1]) * e;
      this.center[2] = this.flyStart[2] + (focusPos[2] - this.flyStart[2]) * e;
    } else {
      this.center = [focusPos[0], focusPos[1], focusPos[2]];
    }
  }

  private orbitPose(center: Km3, fov: number, bodyFrame?: readonly number[]): CameraPose {
    let position = computeOrbitCameraPosition(this.azimuth.value, this.elevation.value, this.distance);
    let up: [number, number, number] = [0, 1, 0];
    if ((this.mode === 'sync' || this.mode === 'frame') && bodyFrame && bodyFrame.length === 9) {
      // Co-rotate with the locked frame: the orbit offset is defined in that
      // reference frame, rotated into J2000 (world) by the frame -> J2000 matrix.
      // 'sync' uses the body's IAU body-fixed frame; 'frame' uses any SPICE frame.
      position = mat3xVec(bodyFrame, position);
      up = mat3xVec(bodyFrame, up);
    }
    // Truck/pan: shift eye and target together along the screen plane.
    const dir: [number, number, number] = [-position[0], -position[1], -position[2]];
    const right = normalize(cross(dir, up));
    const trueUp = normalize(cross(right, dir));
    const offMag = this.distance;
    const off: [number, number, number] = [
      right[0] * this.panX.value * offMag + trueUp[0] * this.panY.value * offMag,
      right[1] * this.panX.value * offMag + trueUp[1] * this.panY.value * offMag,
      right[2] * this.panX.value * offMag + trueUp[2] * this.panY.value * offMag,
    ];
    const rolledUp = rollVector(trueUp, dir, this.roll.value);
    return {
      center,
      position: [position[0] + off[0], position[1] + off[1], position[2] + off[2]],
      target: off,
      up: rolledUp,
      fov,
    };
  }

  private freePose(center: Km3, fov: number): CameraPose {
    const cp = Math.cos(this.freePitch);
    const sp = Math.sin(this.freePitch);
    const cy = Math.cos(this.freeYaw);
    const sy = Math.sin(this.freeYaw);
    const fwd: [number, number, number] = [cp * cy, sp, cp * sy];
    const target: [number, number, number] = [
      this.freePos[0] + fwd[0],
      this.freePos[1] + fwd[1],
      this.freePos[2] + fwd[2],
    ];
    return { center, position: [...this.freePos], target, up: [0, 1, 0], fov };
  }
}

const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const normalize = (v: readonly number[]): [number, number, number] => {
  const m = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / m, v[1]! / m, v[2]! / m];
};

/** Rotate up around the (normalized-on-use) view direction by angle (Rodrigues). */
function rollVector(up: readonly number[], dir: readonly number[], angle: number): [number, number, number] {
  if (Math.abs(angle) < 1e-6) return [up[0]!, up[1]!, up[2]!];
  const k = normalize(dir);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kdotu = k[0] * up[0]! + k[1] * up[1]! + k[2] * up[2]!;
  const kxu = cross(k, up);
  return [
    up[0]! * c + kxu[0] * s + k[0] * kdotu * (1 - c),
    up[1]! * c + kxu[1] * s + k[1] * kdotu * (1 - c),
    up[2]! * c + kxu[2] * s + k[2] * kdotu * (1 - c),
  ];
}
