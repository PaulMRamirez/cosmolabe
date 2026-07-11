// SolarSystemScene coverage-overlay lifecycle: setCoverageOverlay adds a non-empty
// vertex-colored mesh to the world group (anchored to the body), and clearCoverageOverlay
// removes it. WebGLRenderer needs a real GL context that vitest's node environment cannot
// create, so it is mocked; the rest of three is real, so the geometry/material are the
// production objects.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Group, Mesh, Object3D } from 'three';
import type * as ThreeModule from 'three';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof ThreeModule>('three');
  class FakeWebGLRenderer {
    domElement: unknown;
    shadowMap = { enabled: false };
    constructor(opts: { canvas?: unknown } = {}) {
      this.domElement = opts.canvas;
    }
    setClearColor(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

import { SolarSystemScene } from './three-scene.ts';
import type { CoverageOverlaySpec } from './coverage-overlay.ts';

function installDocument(): void {
  const makeEl = (): Record<string, unknown> => ({
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    setAttribute: () => undefined,
    appendChild: (c: unknown) => c,
    remove: () => undefined,
    append: () => undefined,
  });
  (globalThis as { document?: unknown }).document = { createElement: () => makeEl() };
}

function makeCanvas(): HTMLCanvasElement {
  return { width: 64, height: 48, parentElement: { appendChild: () => undefined } } as unknown as HTMLCanvasElement;
}

const SPEC: CoverageOverlaySpec = {
  anchorBody: 'Earth',
  bodyRadiusKm: 6378.137,
  latCount: 2,
  lonCount: 2,
  cells: [
    { latRad: -0.2, lonRad: -0.2, fom: 0 },
    { latRad: -0.2, lonRad: 0.2, fom: 0.5 },
    { latRad: 0.2, lonRad: -0.2, fom: 0.8 },
    { latRad: 0.2, lonRad: 0.2, fom: 1 },
  ],
};

// Count Mesh objects in the world group carrying a vertex-colored geometry (the overlay).
function overlayMeshes(scene: SolarSystemScene): Mesh[] {
  const world = (scene as unknown as { world: Group }).world;
  const found: Mesh[] = [];
  world.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute?.('color')) found.push(mesh);
  });
  return found;
}

describe('SolarSystemScene coverage overlay', () => {
  beforeEach(() => installDocument());

  it('setCoverageOverlay adds a non-empty vertex-colored overlay to the world', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setCoverageOverlay(SPEC);
    const meshes = overlayMeshes(scene);
    expect(meshes.length).toBe(1);
    expect(meshes[0]!.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('clearCoverageOverlay removes the overlay', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setCoverageOverlay(SPEC);
    expect(overlayMeshes(scene).length).toBe(1);
    scene.clearCoverageOverlay();
    expect(overlayMeshes(scene).length).toBe(0);
  });

  it('a second setCoverageOverlay replaces rather than stacks', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setCoverageOverlay(SPEC);
    scene.setCoverageOverlay(SPEC);
    expect(overlayMeshes(scene).length).toBe(1);
  });
});
