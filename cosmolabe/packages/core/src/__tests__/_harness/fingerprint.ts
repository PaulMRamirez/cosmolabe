/**
 * Deterministic scene fingerprint — the broad regression net (Layer 2).
 *
 * Captures every body's absolute position, composed body→world orientation
 * quaternion, frame metadata, and a handful of trajectory samples at fixed
 * offsets from the scene epoch. Serialized (sorted + rounded) to a committed
 * golden JSON; re-running diffs against it. Catches regressions in the
 * analytical/Keplerian/composite paths that have no SPICE oracle, and pins the
 * composed orientation (via composeBodyToWorldQuat) so a render-layer obliquity
 * change shows up as a quaternion diff.
 */
import type { BuiltScene } from './buildUniverse.js';
import { composeBodyToWorldQuat, type Vec3 } from '../../kinematics.js';
import type { Quaternion } from '../../rotations/RotationModel.js';

export interface BodyFingerprint {
  name: string;
  parent: string | null;
  trajectoryFrame: string;
  sourceFrame: string | null;
  absolutePosition: [number, number, number]; // EclipticJ2000 km
  bodyToWorldQuat: [number, number, number, number] | null; // [w,x,y,z], normalized
}

export interface SceneFingerprint {
  scene: string;
  et: number;
  bodies: BodyFingerprint[]; // sorted by name
  trajectories: { name: string; sampleOffsetsSec: number[]; samples: [number, number, number][] }[];
}

/** Hours-from-epoch sample offsets — wide enough to expose an orbital-plane tilt. */
const SAMPLE_OFFSETS_HR = [-12, -6, 0, 6, 12];

function round(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** decimals;
  // +0 avoids "-0" in the serialized output.
  return Math.round(x * f) / f + 0;
}

function normalizeQuat(q: Quaternion): Quaternion {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // Canonical sign (w ≥ 0) so q and -q (same rotation) serialize identically.
  const s = (q[0] < 0 ? -1 : 1) / n;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

export function fingerprintScene(built: BuiltScene, sceneName: string): SceneFingerprint {
  const { universe, et } = built;
  const bodies = universe.getAllBodies().slice().sort((a, b) => a.name.localeCompare(b.name));

  const bodyFps: BodyFingerprint[] = bodies.map((body) => {
    const pos = universe.absolutePositionOf(body.name, et);
    let quat: [number, number, number, number] | null = null;
    const sourceFrame = body.rotation?.sourceFrame ?? null;
    const q = body.rotation ? body.rotationAt(et) : undefined;
    if (q && sourceFrame) {
      const bw = normalizeQuat(composeBodyToWorldQuat(q, sourceFrame));
      quat = [round(bw[0], 9), round(bw[1], 9), round(bw[2], 9), round(bw[3], 9)];
    }
    return {
      name: body.name,
      parent: body.parentName ?? null,
      trajectoryFrame: body.trajectoryFrame ?? 'ecliptic',
      sourceFrame,
      absolutePosition: [round(pos[0], 6), round(pos[1], 6), round(pos[2], 6)],
      bodyToWorldQuat: quat,
    };
  });

  // Sample only bodies whose position varies (skip fixed origin points to keep
  // goldens meaningful — a static body's samples are all identical).
  const trajectories = bodies
    .map((body) => {
      const samples = SAMPLE_OFFSETS_HR.map((hr) => {
        const p = universe.absolutePositionOf(body.name, et + hr * 3600);
        return [round(p[0], 6), round(p[1], 6), round(p[2], 6)] as Vec3;
      });
      return { name: body.name, sampleOffsetsSec: SAMPLE_OFFSETS_HR.map((h) => h * 3600), samples };
    })
    .filter((t) => {
      const [a, b] = [t.samples[0], t.samples[t.samples.length - 1]];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-6; // moving bodies only
    });

  return { scene: sceneName, et: round(et, 6), bodies: bodyFps, trajectories };
}

/** Pretty, stable JSON for a reviewable git diff. */
export function serializeFingerprint(fp: SceneFingerprint): string {
  return JSON.stringify(fp, null, 2) + '\n';
}
