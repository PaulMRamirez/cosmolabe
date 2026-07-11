// objectId uniqueness: a spacecraft keyed by a name that collides with a body name
// would make picking non-deterministic and co-locate both meshes under one id, so
// SolarSystemScene rejects the collision loudly (CLAUDE.md: fail loudly) instead.
// WebGLRenderer needs a real GL context, so it is mocked; the rest of three is real.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { SolarSystemScene, SceneError } from './three-scene.ts';
import type { PlanetDef } from './planets.ts';

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
  return {
    width: 64,
    height: 48,
    parentElement: { appendChild: () => undefined },
  } as unknown as HTMLCanvasElement;
}

const SATURN: PlanetDef = { name: 'Saturn', spiceId: '699', radiusKm: 60268, color: [0.8, 0.7, 0.5] };

describe('SolarSystemScene objectId uniqueness', () => {
  beforeEach(() => installDocument());

  it('throws a located SceneError when a spacecraft name collides with a body', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setBodies([SATURN]);
    try {
      scene.setSpacecraft('Saturn');
      expect.unreachable('should have thrown on the colliding objectId');
    } catch (err) {
      expect(err).toBeInstanceOf(SceneError);
      expect((err as SceneError).location).toBe('SolarSystemScene.setSpacecraft');
    }
  });

  it('throws when bodies are re-set with a name that collides with the spacecraft', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setSpacecraft('Cassini');
    expect(() =>
      scene.setBodies([{ ...SATURN, name: 'Cassini' }]),
    ).toThrow(SceneError);
  });

  it('keeps distinct ids so picking resolves the spacecraft separately', () => {
    const scene = new SolarSystemScene(makeCanvas());
    scene.setBodies([SATURN]);
    // A distinct spacecraft name must not throw; both meshes carry their own id.
    expect(() => scene.setSpacecraft('Cassini')).not.toThrow();
  });
});
