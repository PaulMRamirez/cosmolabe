// Body globe materials. Item 2 (rendering fidelity): a body can carry an image
// base-map (and normal map) URL and render with real textures; without one it
// falls back to the procedural latitude-banded texture so globes always read as
// surfaces. The texture choice and material assembly are split out here so they
// are unit-testable with injected loaders (no WebGL or DOM needed).

import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  type Texture,
} from 'three';
import type { PlanetDef } from './planets.ts';

/** Procedural latitude-banded texture from a base color (no image assets). */
export function proceduralBodyTexture(color: readonly [number, number, number]): DataTexture {
  const w = 32;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const band = 0.85 + 0.15 * Math.sin((y / h) * Math.PI * 6);
      const lon = 0.92 + 0.08 * Math.sin((x / w) * Math.PI * 4);
      const k = band * lon;
      const i = (y * w + x) * 4;
      data[i] = Math.min(255, color[0] * 255 * k);
      data[i + 1] = Math.min(255, color[1] * 255 * k);
      data[i + 2] = Math.min(255, color[2] * 255 * k);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export type BodyTextureSource =
  | { readonly kind: 'image'; readonly url: string }
  | { readonly kind: 'procedural' };

/** An image base-map wins when the body declares one; otherwise procedural. */
export function chooseBodyTextureSource(def: PlanetDef): BodyTextureSource {
  return def.texture ? { kind: 'image', url: def.texture } : { kind: 'procedural' };
}

export interface BodyMaterialDeps {
  /** Load an image texture from a URL (real: TextureLoader; tests: a stub). */
  readonly loadImageTexture: (url: string) => Texture;
  /** Build the procedural fallback texture from a color. */
  readonly proceduralTexture: (color: readonly [number, number, number]) => Texture;
}

/** Default cloud-shell altitude (km) above the surface (Cosmographia setCloudAltitude). */
export const DEFAULT_CLOUD_ALTITUDE_KM = 6.0;

/** A separate translucent cloud shell to render above a globe (Cosmographia cloudMap). */
export interface CloudShellDescriptor {
  /** Cloud-layer image URL. */
  readonly cloudMap: string;
  /** Shell altitude above the surface, km. */
  readonly altitudeKm: number;
}

/**
 * The cloud shell, if the body declares a cloud map. The shell is NOT painted on
 * the base material; it is a second translucent sphere the scene builds at
 * radius + altitude. Returns null when the body has no cloud layer.
 */
export function cloudShellDescriptor(def: PlanetDef): CloudShellDescriptor | null {
  if (!def.cloudMap) return null;
  return { cloudMap: def.cloudMap, altitudeKm: def.cloudAltitudeKm ?? DEFAULT_CLOUD_ALTITUDE_KM };
}

const relativeLuminance = (rgb: readonly [number, number, number]): number =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

/** Build a body globe material, using an image base-map when the body has one. */
export function buildBodyMaterial(def: PlanetDef, deps: BodyMaterialDeps): MeshStandardMaterial {
  const source = chooseBodyTextureSource(def);
  const map =
    source.kind === 'image' ? deps.loadImageTexture(source.url) : deps.proceduralTexture(def.color);
  // Equirectangular base maps wrap in longitude (S) and clamp at the poles (T).
  map.wrapS = RepeatWrapping;
  map.wrapT = ClampToEdgeWrapping;
  const material = new MeshStandardMaterial({
    map,
    emissive: new Color(def.color[0], def.color[1], def.color[2]),
    emissiveIntensity: def.name === 'Sun' ? 0.9 : 0.08,
    roughness: 0.9,
    metalness: 0.0,
  });
  if (def.normalMap) material.normalMap = deps.loadImageTexture(def.normalMap);
  // Night-lights: a separate emissive map self-lights the dark side (city lights).
  // White emissive so the map's own color shows; the Sun keeps its name-based glow.
  if (def.nightTexture && def.name !== 'Sun') {
    material.emissiveMap = deps.loadImageTexture(def.nightTexture);
    material.emissive = new Color(1, 1, 1);
    material.emissiveIntensity = 0.6;
  }
  // Ocean glint: a specular color + power maps to a low metalness (from the
  // specular luminance) and a roughness (from the power). Both must be present.
  if (def.specularColor && def.specularPower !== undefined) {
    material.metalness = Math.min(0.3, relativeLuminance(def.specularColor) * 0.3);
    material.roughness = Math.max(0.05, 1 / (1 + def.specularPower));
  }
  return material;
}
