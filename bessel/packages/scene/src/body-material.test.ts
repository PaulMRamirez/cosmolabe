// Item 2 (rendering fidelity): a body with an image base-map renders with that
// image; without one it uses the procedural fallback. The choice and material
// assembly are tested with injected loaders so no WebGL or DOM is needed.

import { describe, it, expect } from 'vitest';
import { ClampToEdgeWrapping, Color, RepeatWrapping, Texture } from 'three';
import {
  chooseBodyTextureSource,
  buildBodyMaterial,
  cloudShellDescriptor,
  DEFAULT_CLOUD_ALTITUDE_KM,
} from './body-material.ts';
import type { PlanetDef } from './planets.ts';

const PLAIN: PlanetDef = { name: 'Mars', spiceId: '4', radiusKm: 3390, color: [0.7, 0.4, 0.25] };
const TEXTURED: PlanetDef = { ...PLAIN, texture: 'mars.jpg', normalMap: 'mars_normal.jpg' };

describe('chooseBodyTextureSource', () => {
  it('prefers an image map when the body declares a texture', () => {
    expect(chooseBodyTextureSource(TEXTURED)).toEqual({ kind: 'image', url: 'mars.jpg' });
  });

  it('falls back to procedural without a texture', () => {
    expect(chooseBodyTextureSource(PLAIN)).toEqual({ kind: 'procedural' });
  });
});

describe('buildBodyMaterial', () => {
  it('uses the procedural texture and never calls the image loader for a plain body', () => {
    const procedural = new Texture();
    let imageCalls = 0;
    const material = buildBodyMaterial(PLAIN, {
      loadImageTexture: () => {
        imageCalls += 1;
        return new Texture();
      },
      proceduralTexture: () => procedural,
    });
    expect(material.map).toBe(procedural);
    expect(imageCalls).toBe(0);
    expect(material.normalMap).toBeNull();
  });

  it('loads the image base-map and normal map when present', () => {
    const byUrl = new Map<string, Texture>();
    const material = buildBodyMaterial(TEXTURED, {
      loadImageTexture: (url) => {
        const t = new Texture();
        byUrl.set(url, t);
        return t;
      },
      proceduralTexture: () => new Texture(),
    });
    expect(material.map).toBe(byUrl.get('mars.jpg'));
    expect(material.normalMap).toBe(byUrl.get('mars_normal.jpg'));
  });

  it('sets the base-map wrap modes to Repeat (S) and ClampToEdge (T)', () => {
    const map = new Texture();
    const material = buildBodyMaterial(TEXTURED, {
      loadImageTexture: () => map,
      proceduralTexture: () => new Texture(),
    });
    expect(material.map!.wrapS).toBe(RepeatWrapping);
    expect(material.map!.wrapT).toBe(ClampToEdgeWrapping);
  });

  it('drives the emissive map and white emissive from a night texture', () => {
    const earth: PlanetDef = {
      ...PLAIN,
      name: 'Earth',
      texture: 'earth.jpg',
      nightTexture: 'earth_night.jpg',
    };
    const byUrl = new Map<string, Texture>();
    const material = buildBodyMaterial(earth, {
      loadImageTexture: (url) => {
        const t = new Texture();
        byUrl.set(url, t);
        return t;
      },
      proceduralTexture: () => new Texture(),
    });
    expect(material.emissiveMap).toBe(byUrl.get('earth_night.jpg'));
    expect(material.emissive.equals(new Color(1, 1, 1))).toBe(true);
    expect(material.emissiveIntensity).toBeCloseTo(0.6);
  });

  it('maps specularColor + specularPower to metalness and roughness only when both set', () => {
    const ocean: PlanetDef = { ...PLAIN, specularColor: [1, 1, 1], specularPower: 19 };
    const material = buildBodyMaterial(ocean, {
      loadImageTexture: () => new Texture(),
      proceduralTexture: () => new Texture(),
    });
    expect(material.metalness).toBeGreaterThan(0);
    expect(material.roughness).toBeCloseTo(1 / 20);

    // Only specularColor (no power): no glint applied, defaults kept.
    const partial: PlanetDef = { ...PLAIN, specularColor: [1, 1, 1] };
    const plain = buildBodyMaterial(partial, {
      loadImageTexture: () => new Texture(),
      proceduralTexture: () => new Texture(),
    });
    expect(plain.metalness).toBe(0);
    expect(plain.roughness).toBe(0.9);
  });
});

describe('cloudShellDescriptor', () => {
  it('returns null when the body has no cloud map', () => {
    expect(cloudShellDescriptor(PLAIN)).toBeNull();
  });

  it('returns a separate shell descriptor with the default altitude', () => {
    const earth: PlanetDef = { ...PLAIN, name: 'Earth', cloudMap: 'clouds.png' };
    expect(cloudShellDescriptor(earth)).toEqual({
      cloudMap: 'clouds.png',
      altitudeKm: DEFAULT_CLOUD_ALTITUDE_KM,
    });
  });

  it('honors an explicit cloud altitude', () => {
    const earth: PlanetDef = { ...PLAIN, cloudMap: 'clouds.png', cloudAltitudeKm: 12 };
    expect(cloudShellDescriptor(earth)?.altitudeKm).toBe(12);
  });
});
