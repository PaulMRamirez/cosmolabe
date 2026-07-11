// Camera controller kinematics: damping reaches its target without overshoot,
// angle wrap takes the short way, radius framing scales correctly, and the modes
// (orbit / sync / track / free) compose the expected pose.

import { describe, it, expect } from 'vitest';
import { computeOrbitCameraPosition, computeTrackCameraPosition } from './camera-modes.ts';
import {
  CameraController,
  framingDistance,
  nearestAngle,
  smoothDamp,
} from './camera-controller.ts';

const TWO_PI = Math.PI * 2;

/** Run the controller forward to rest (fixed timestep). */
function settle(c: CameraController, focusPos: [number, number, number] = [0, 0, 0]): void {
  for (let i = 0; i < 600; i++) c.step({ dt: 1 / 60, focusPos });
}

describe('smoothDamp', () => {
  it('approaches the target monotonically without overshoot', () => {
    const vel = { v: 0 };
    let x = 0;
    let prev = 0;
    for (let i = 0; i < 300; i++) {
      x = smoothDamp(x, 1, vel, 0.1, 1 / 60);
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9); // never goes backward
      expect(x).toBeLessThanOrEqual(1 + 1e-9); // never overshoots past 1
      prev = x;
    }
    expect(x).toBeCloseTo(1, 4);
  });

  it('is a no-op for a non-positive timestep', () => {
    expect(smoothDamp(3, 9, { v: 0 }, 0.2, 0)).toBe(3);
  });
});

describe('nearestAngle', () => {
  it('takes the short way around the circle', () => {
    expect(nearestAngle(0, TWO_PI - 0.1)).toBeCloseTo(-0.1, 9);
    expect(nearestAngle(0, Math.PI + 0.2)).toBeCloseTo(-(Math.PI - 0.2), 9);
    expect(nearestAngle(10, 10)).toBeCloseTo(10, 9);
  });
});

describe('framingDistance', () => {
  it('grows with radius and with a narrower field of view', () => {
    const a = framingDistance(1, 45);
    const b = framingDistance(2, 45);
    const narrow = framingDistance(1, 20);
    expect(b).toBeGreaterThan(a);
    expect(narrow).toBeGreaterThan(a);
  });
});

describe('CameraController', () => {
  it('snaps the view center to the focus on the first step', () => {
    const c = new CameraController();
    const pose = c.step({ dt: 1 / 60, focusPos: [5, 6, 7] });
    expect(pose.center).toEqual([5, 6, 7]);
  });

  it('snaps to a set view and frames an orbit position', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    const pose = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] });
    const expected = computeOrbitCameraPosition(0, 0, 100);
    expect(pose.position[0]).toBeCloseTo(expected[0], 6);
    expect(pose.position[1]).toBeCloseTo(expected[1], 6);
    expect(pose.position[2]).toBeCloseTo(expected[2], 6);
  });

  it('eases toward an orbit delta and a new zoom', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    settle(c);
    c.orbitBy(1, 0);
    c.zoomBy(2);
    settle(c);
    expect(c.azimuthValue).toBeCloseTo(1, 2);
    expect(c.distance).toBeCloseTo(200, 0);
  });

  it('glides the center between focuses on flyTo', () => {
    const c = new CameraController();
    c.snapCenter([0, 0, 0]);
    c.flyTo();
    // Part-way through the glide the center is between the old and new focus.
    const mid = c.step({ dt: 0.1, focusPos: [100, 0, 0] });
    expect(mid.center[0]).toBeGreaterThan(0);
    expect(mid.center[0]).toBeLessThan(100);
    for (let i = 0; i < 120; i++) c.step({ dt: 1 / 60, focusPos: [100, 0, 0] });
    const done = c.step({ dt: 1 / 60, focusPos: [100, 0, 0] });
    expect(done.center[0]).toBeCloseTo(100, 3);
  });

  it('sync mode with an identity body frame matches orbit', () => {
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const c = new CameraController();
    c.setView(0.4, 0.2, 100, false);
    c.setMode('sync');
    const pose = c.step({ dt: 1 / 60, focusPos: [0, 0, 0], bodyFrame: id });
    const expected = computeOrbitCameraPosition(0.4, 0.2, 100);
    expect(pose.position[0]).toBeCloseTo(expected[0], 4);
    expect(pose.position[2]).toBeCloseTo(expected[2], 4);
  });

  it('frame mode applies an arbitrary SPICE frame rotation to the orbit basis', () => {
    // A 90-degree rotation about +Y: a frame->J2000 matrix. The orbit offset is
    // defined in the frame, then rotated into world, so the pose differs from
    // plain orbit by that rotation (the parity with sync, generalized).
    const rotY90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.setMode('frame');
    const pose = c.step({ dt: 1 / 60, focusPos: [0, 0, 0], bodyFrame: rotY90 });
    const base = computeOrbitCameraPosition(0, 0, 100); // [100, 0, 0]
    // rotY90 * [100,0,0] = [0, 0, -100].
    expect(pose.position[0]).toBeCloseTo(base[2], 4);
    expect(pose.position[2]).toBeCloseTo(-base[0], 4);
  });

  it('dollyBy translates along the view axis (a distance change in orbit)', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    settle(c);
    c.dollyBy(0.5); // forward: closer
    settle(c);
    expect(c.distance).toBeLessThan(100);
    c.dollyBy(-0.9); // backward: farther than where it started
    settle(c);
    expect(c.distance).toBeGreaterThan(100);
  });

  it('craneBy shifts the viewpoint vertically (pan offset, not a look rotation)', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    settle(c);
    const before = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] }).position;
    c.craneBy(0.4);
    settle(c);
    const after = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] }).position;
    expect(after[1]).toBeGreaterThan(before[1] + 1); // the eye rose
  });

  it('track mode places the camera behind the velocity', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.setMode('track');
    const pose = c.step({ dt: 1 / 60, focusPos: [0, 0, 0], focusVelocity: [1, 0, 0] });
    const expected = computeTrackCameraPosition([1, 0, 0], 100);
    expect(pose.position[0]).toBeCloseTo(expected[0], 4);
    expect(pose.position[1]).toBeCloseTo(expected[1], 4);
  });

  it('resets roll when a view is set (so a preset re-levels the horizon)', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.rollBy(0.6);
    settle(c);
    const tilted = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] });
    expect(Math.abs(tilted.up[2])).toBeGreaterThan(0.05); // horizon is rolled
    c.setView(0, 0, 100, false); // a framing snaps roll back to level
    const level = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] });
    expect(Math.abs(level.up[2])).toBeLessThan(1e-6);
  });

  it('resumes orbit from the free position when leaving free (no snap-back)', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.setMode('free');
    c.flyMove(50, 0, 0); // dolly forward from radius 100 toward the center
    c.setMode('orbit');
    expect(c.distance).toBeCloseTo(50, 0); // orbit distance follows the free pose
  });

  it('preserves the free pose across a track on/off cycle', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.setMode('free');
    c.flyMove(20, 0, 0);
    const radius = c.freeRadius;
    c.setMode('track'); // tracking overrides free transiently
    c.setMode('free'); // returning must not reseed the free pose
    expect(c.freeRadius).toBeCloseTo(radius, 6);
  });

  it('free mode translates along its own forward axis', () => {
    const c = new CameraController();
    c.setView(0, 0, 100, false);
    c.setMode('free');
    const before = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] }).position;
    c.flyMove(10, 0, 0);
    const after = c.step({ dt: 1 / 60, focusPos: [0, 0, 0] }).position;
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    expect(moved).toBeGreaterThan(1);
  });
});
