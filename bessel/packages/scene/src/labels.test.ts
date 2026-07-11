import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { projectToScreen } from './labels.ts';

describe('projectToScreen', () => {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  it('projects the look-at point to the screen center', () => {
    const p = projectToScreen(new Vector3(0, 0, 0), camera, 800, 600);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(400, 1);
    expect(p.y).toBeCloseTo(300, 1);
  });

  it('reports a point behind the camera as not visible', () => {
    const p = projectToScreen(new Vector3(0, 0, 50), camera, 800, 600);
    expect(p.visible).toBe(false);
  });

  it('reports an off-screen point as not visible', () => {
    const p = projectToScreen(new Vector3(100, 0, 0), camera, 800, 600);
    expect(p.visible).toBe(false);
  });
});
