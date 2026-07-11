// Atmospheric limb glow: a back-faced sky shell with a simplified single-scattering
// Rayleigh (lambda^-4) plus Mie (Henyey-Greenstein) fragment shader. The shader
// cannot run under node vitest, so the scattering math and uniform packing are the
// unit-tested surface; rendering is verified by the e2e non-empty-frame assertion.

import {
  AdditiveBlending,
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { SCALE } from './geometry-builders.ts';
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_VERTEX } from './shaders/atmosphere.glsl.ts';

/** Rayleigh scattering coefficients (relative) for R, G, B by wavelength^-4. */
export function rayleighCoefficients(): [number, number, number] {
  const lr = 680;
  const lg = 550;
  const lb = 440;
  const r = Math.pow(lg / lr, 4);
  const g = 1;
  const b = Math.pow(lg / lb, 4);
  return [r, g, b];
}

export interface AtmosphereParams {
  readonly sunDirection: readonly [number, number, number];
  readonly color?: readonly [number, number, number];
  readonly intensity?: number;
}

export interface AtmosphereUniforms {
  readonly uSunDirection: { value: Vector3 };
  readonly uRayleigh: { value: Vector3 };
  readonly uColor: { value: Color };
  readonly uIntensity: { value: number };
}

/** Pack the atmosphere shader uniforms from parameters. */
export function buildAtmosphereUniforms(params: AtmosphereParams): AtmosphereUniforms {
  const [r, g, b] = rayleighCoefficients();
  const c = params.color ?? [0.35, 0.5, 1.0];
  return {
    uSunDirection: { value: new Vector3(...params.sunDirection) },
    uRayleigh: { value: new Vector3(r, g, b) },
    uColor: { value: new Color(c[0], c[1], c[2]) },
    uIntensity: { value: params.intensity ?? 1.0 },
  };
}

/** Build the atmosphere sky-shell mesh around a planet. */
export function buildAtmosphere(
  planetRadiusKm: number,
  atmosphereRadiusKm: number,
  params: AtmosphereParams,
): Mesh {
  const geometry = new SphereGeometry(atmosphereRadiusKm * SCALE, 48, 32);
  const material = new ShaderMaterial({
    uniforms: buildAtmosphereUniforms(params) as unknown as Record<string, { value: unknown }>,
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  material.uniforms['uPlanetRadius'] = { value: planetRadiusKm * SCALE };
  return new Mesh(geometry, material);
}
