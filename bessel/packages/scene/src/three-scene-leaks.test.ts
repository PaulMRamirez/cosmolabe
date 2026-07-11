// GPU-resource lifecycle tests for SolarSystemScene: reset()/re-set must dispose
// the textures, lights, and spacecraft meshes a rebuild would otherwise leak, and
// the star field must be parented to a fixed (J2000) group rather than the camera
// (so the sky does not screen-lock to the view). WebGLRenderer cannot create a GL
// context under vitest's node environment, so it is mocked; the rest of three is
// real, so geometries/materials/textures behave as in production.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Points,
  SphereGeometry,
  type Object3D,
} from 'three';
import type * as ThreeModule from 'three';

// Mock only WebGLRenderer (it needs a real GL context); keep every other three
// export real so the scene's actual geometry/material/texture objects are used.
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

import { SolarSystemScene, disposeDeep } from './three-scene.ts';
import type { PlanetDef } from './planets.ts';
import type { Star } from './star-catalog.ts';

// A minimal DOM stub: the scene and LabelLayer only need createElement to return
// an element-shaped object with a style bag, dataset, and the few methods used.
function installDocument(): void {
  const makeEl = (): Record<string, unknown> => {
    const children: unknown[] = [];
    return {
      style: {},
      dataset: {},
      className: '',
      textContent: '',
      setAttribute: () => undefined,
      appendChild: (c: unknown) => {
        children.push(c);
        return c;
      },
      remove: () => undefined,
      append: () => undefined,
    };
  };
  (globalThis as { document?: unknown }).document = { createElement: () => makeEl() };
}

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 64,
    height: 48,
    parentElement: { appendChild: () => undefined },
  } as unknown as HTMLCanvasElement;
}

const PLANET: PlanetDef = {
  name: 'Testus',
  spiceId: '999',
  radiusKm: 1000,
  color: [0.4, 0.6, 0.8],
};

const STARS: readonly Star[] = [
  { ra: 0, dec: 0, mag: 1 },
  { ra: 1, dec: 0.5, mag: 3 },
];

describe('disposeDeep texture walk', () => {
  it('disposes every named material texture slot, not just the material', () => {
    const material = new MeshStandardMaterial();
    const map = { isTexture: true, dispose: vi.fn() };
    const emissiveMap = { isTexture: true, dispose: vi.fn() };
    const normalMap = { isTexture: true, dispose: vi.fn() };
    // Assign through an index cast: these are the real slot names disposeDeep walks.
    (material as unknown as Record<string, unknown>)['map'] = map;
    (material as unknown as Record<string, unknown>)['emissiveMap'] = emissiveMap;
    (material as unknown as Record<string, unknown>)['normalMap'] = normalMap;
    const matDispose = vi.spyOn(material, 'dispose');
    const mesh = new Mesh(new SphereGeometry(1, 4, 2), material);

    disposeDeep(mesh);

    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(map.dispose).toHaveBeenCalledTimes(1);
    expect(emissiveMap.dispose).toHaveBeenCalledTimes(1);
    expect(normalMap.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes ShaderMaterial uniform textures', () => {
    const tex = { isTexture: true, dispose: vi.fn() };
    const material = {
      uniforms: { uMap: { value: tex }, uScalar: { value: 0.5 } },
      dispose: vi.fn(),
    };
    const mesh = new Mesh(new SphereGeometry(1, 4, 2));
    (mesh as unknown as { material: unknown }).material = material;

    disposeDeep(mesh);

    expect(tex.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('SolarSystemScene resource disposal', () => {
  beforeEach(() => installDocument());

  it('reset() disposes the body diffuse texture (procedural DataTexture)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setBodies([PLANET]);
    // Reach the body mesh material map and spy its dispose.
    const root = (scene as unknown as { world: Group }).world;
    let map: { dispose: () => void } | undefined;
    root.traverse((o: Object3D) => {
      const m = (o as unknown as { material?: { map?: { dispose: () => void } } }).material;
      if (m?.map) map = m.map;
    });
    expect(map).toBeDefined();
    const spy = vi.spyOn(map!, 'dispose');

    scene.reset();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('SolarSystemScene star field parenting', () => {
  beforeEach(() => installDocument());

  it('parents stars to a fixed group, never to the camera', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setStarField(STARS);

    const camera = (scene as unknown as { camera: { children: Object3D[] } }).camera;
    const group = (scene as unknown as { starFieldGroup: Group }).starFieldGroup;
    const stars = (scene as unknown as { starField: Object3D | null }).starField;

    expect(stars).toBeInstanceOf(Points);
    // The star field is a child of the fixed group, not the camera.
    expect(group.children).toContain(stars);
    expect(camera.children).not.toContain(stars);
  });

  it('the star group keeps an identity rotation (J2000, not camera-locked)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setStarField(STARS);
    const group = (scene as unknown as { starFieldGroup: Group }).starFieldGroup;
    // No rotation is ever applied to the group; the camera rotation is not inherited.
    expect(group.rotation.x).toBe(0);
    expect(group.rotation.y).toBe(0);
    expect(group.rotation.z).toBe(0);
    expect(group.quaternion.w).toBe(1);
  });

  it('reset() disposes and clears the star field', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setStarField(STARS);
    const stars = (scene as unknown as { starField: Object3D }).starField;
    const geomDispose = vi.spyOn(
      (stars as unknown as { geometry: { dispose: () => void } }).geometry,
      'dispose',
    );

    scene.reset();

    expect(geomDispose).toHaveBeenCalledTimes(1);
    expect((scene as unknown as { starField: Object3D | null }).starField).toBeNull();
  });
});

describe('SolarSystemScene shadow light lifecycle', () => {
  beforeEach(() => installDocument());

  it('a second enableShadows removes and disposes the prior light (no stacking)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.enableShadows(1000);
    const first = (scene as unknown as { sunLight: { dispose: () => void; target: Object3D } }).sunLight;
    const world = (scene as unknown as { world: Group }).world;
    expect(world.children).toContain(first);
    const firstDispose = vi.spyOn(first, 'dispose');

    scene.enableShadows(2000);

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(world.children).not.toContain(first);
    // Exactly one shadow light is present after the re-enable.
    const lights = world.children.filter(
      (c) => (c as unknown as { isDirectionalLight?: boolean }).isDirectionalLight,
    );
    expect(lights).toHaveLength(1);
  });

  it('aims the light along the Sun -> body direction (non-zero, target on the body)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setBodies([PLANET]);
    scene.setPositions(new Map([['Testus', [3, 0, 0]]]));
    scene.centerOn('Testus', false);
    scene.enableShadows(1000);
    const light = (scene as unknown as {
      sunLight: { position: { length: () => number }; target: { position: { x: number } } };
    }).sunLight;
    // The shadow direction is defined (the light is not at the origin / zero vector).
    expect(light.position.length()).toBeGreaterThan(0);
    // The target sits on the focused body (positive x in scaled world units).
    expect(light.target.position.x).toBeGreaterThan(0);
  });

  it('disableShadows removes and disposes the light', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.enableShadows(1000);
    const light = (scene as unknown as { sunLight: { dispose: () => void } }).sunLight;
    const dispose = vi.spyOn(light, 'dispose');
    const world = (scene as unknown as { world: Group }).world;

    scene.disableShadows();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(world.children).not.toContain(light);
    expect((scene as unknown as { sunLight: unknown }).sunLight).toBeNull();
  });

  it('reset() removes and disposes the shadow light', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.enableShadows(1000);
    const light = (scene as unknown as { sunLight: { dispose: () => void } }).sunLight;
    const dispose = vi.spyOn(light, 'dispose');

    scene.reset();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect((scene as unknown as { sunLight: unknown }).sunLight).toBeNull();
  });
});

describe('SolarSystemScene spacecraft model disposal', () => {
  beforeEach(() => installDocument());

  it('setSpacecraftModel disposes the prior marker mesh (geometry + material)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setSpacecraft('Probe', 200);
    const marker = (scene as unknown as { spacecraft: { mesh: Mesh } }).spacecraft.mesh;
    const geomDispose = vi.spyOn(marker.geometry, 'dispose');
    const matDispose = vi.spyOn(marker.material as MeshStandardMaterial, 'dispose');

    scene.setSpacecraftModel(new Group());

    expect(geomDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });

  it('reset() after a model load disposes the wrapper exactly once (no double-drop)', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setSpacecraft('Probe', 200);
    const inner = new Mesh(new SphereGeometry(1, 4, 2), new MeshStandardMaterial());
    scene.setSpacecraftModel(inner);
    const innerGeomDispose = vi.spyOn(inner.geometry, 'dispose');

    // A double-drop would dispose the same subtree twice; assert exactly once.
    scene.reset();

    expect(innerGeomDispose).toHaveBeenCalledTimes(1);
    expect((scene as unknown as { spacecraft: unknown }).spacecraft).toBeNull();
    expect((scene as unknown as { spacecraftModel: unknown }).spacecraftModel).toBeNull();
  });
});
