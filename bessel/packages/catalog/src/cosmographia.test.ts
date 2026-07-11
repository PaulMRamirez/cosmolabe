// Texture-fidelity parity (ADR-0006): a Cosmographia Globe declaring baseMap /
// cloudMap / specularColor round-trips into the native Globe with texture /
// cloudMap / specularColor, and a RingSystem maps its radii + texture.

import { describe, it, expect } from 'vitest';
import { cosmographiaGeometryToNative } from './cosmographia.ts';
import { CatalogError } from './index.ts';

describe('cosmographiaGeometryToNative (Globe)', () => {
  it('maps baseMap to the native texture and carries cloud/specular fields', () => {
    const g = cosmographiaGeometryToNative({
      type: 'Globe',
      radii: [60268, 60268, 54364],
      baseMap: 'textures/saturn.jpg',
      cloudMap: 'textures/clouds.png',
      specularColor: '#202030',
      specularPower: 20,
      emissive: false,
    });
    expect(g).toEqual({
      type: 'Globe',
      radii: [60268, 60268, 54364],
      texture: 'textures/saturn.jpg',
      cloudMap: 'textures/clouds.png',
      specularColor: '#202030',
      specularPower: 20,
      emissive: false,
    });
  });

  it('keeps an explicit native texture when baseMap is absent', () => {
    const g = cosmographiaGeometryToNative({ type: 'Globe', texture: 'earth.jpg' });
    expect(g).toEqual({ type: 'Globe', texture: 'earth.jpg' });
  });
});

describe('cosmographiaGeometryToNative (RingSystem)', () => {
  it('maps innerRadius/outerRadius/texture into a native Rings geometry', () => {
    const g = cosmographiaGeometryToNative({
      type: 'RingSystem',
      innerRadius: 74500,
      outerRadius: 140220,
      texture: 'textures/saturn-rings.png',
    });
    expect(g).toEqual({
      type: 'Rings',
      innerRadius: 74500,
      outerRadius: 140220,
      texture: 'textures/saturn-rings.png',
    });
  });

  it('fails loudly when a ring system omits its radii', () => {
    expect(() => cosmographiaGeometryToNative({ type: 'RingSystem', texture: 'r.png' })).toThrow(
      CatalogError,
    );
  });
});

describe('cosmographiaGeometryToNative (extended types)', () => {
  it('maps a Mesh geometry with source and scale', () => {
    expect(cosmographiaGeometryToNative({ type: 'Mesh', source: 'models/probe.obj', scale: 2 })).toEqual({
      type: 'Mesh',
      source: 'models/probe.obj',
      scale: 2,
    });
  });

  it('maps a DSK geometry', () => {
    expect(cosmographiaGeometryToNative({ type: 'DSK', source: 'shape.bds' })).toEqual({
      type: 'DSK',
      source: 'shape.bds',
    });
  });

  it('maps a ParticleSystem geometry', () => {
    expect(cosmographiaGeometryToNative({ type: 'ParticleSystem', source: 'tail.json', count: 5000 })).toEqual({
      type: 'ParticleSystem',
      source: 'tail.json',
      particleCount: 5000,
    });
  });

  it('maps a KeplerianSwarm geometry', () => {
    expect(cosmographiaGeometryToNative({ type: 'KeplerianSwarm', source: 'belt.json', color: '#888' })).toEqual({
      type: 'KeplerianSwarm',
      source: 'belt.json',
      color: '#888',
    });
  });

  it('maps a TimeSwitched geometry over its segments', () => {
    expect(
      cosmographiaGeometryToNative({
        type: 'TimeSwitched',
        segments: [
          {
            timeRange: { start: '2004-01-01T00:00:00Z', stop: '2004-02-01T00:00:00Z' },
            geometry: { type: 'Mesh', source: 'a.obj' },
          },
        ],
      }),
    ).toEqual({
      type: 'TimeSwitched',
      segments: [
        {
          timeRange: { start: '2004-01-01T00:00:00Z', stop: '2004-02-01T00:00:00Z' },
          geometry: { type: 'Mesh', source: 'a.obj' },
        },
      ],
    });
  });

  it('returns null for an unknown geometry type', () => {
    expect(cosmographiaGeometryToNative({ type: 'NotAThing' })).toBeNull();
  });
});
