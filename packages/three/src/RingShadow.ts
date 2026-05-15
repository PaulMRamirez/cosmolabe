import * as THREE from 'three';

// ---- Ring-on-body shadow GLSL injection ----
// Cast a ray from the fragment toward the sun, intersect the ring plane,
// and if the intersection lies within the ring annulus, sample the ring
// texture's alpha at that radial position and use it to darken the body.
//
// Reuses uSunWorldPos / vShadowWorldPos declared by SHADOW_FRAG_PARS, so
// eclipse-shadow inject must be applied first.

export const RING_SHADOW_FRAG_PARS = /* glsl */`
uniform sampler2D uRingMap;
uniform vec3      uRingCenterWorld;
uniform vec3      uRingNormalWorld;
uniform float     uRingInnerRadius;
uniform float     uRingOuterRadius;

float computeRingShadow() {
  vec3 toSun = uSunWorldPos - vShadowWorldPos;
  float distToSun = length(toSun);
  if (distToSun < 1e-20) return 1.0;
  vec3 L = toSun / distToSun;

  float denom = dot(L, uRingNormalWorld);
  // Ray nearly parallel to ring plane — no meaningful shadow.
  if (abs(denom) < 1e-6) return 1.0;

  float t = dot(uRingCenterWorld - vShadowWorldPos, uRingNormalWorld) / denom;
  // Ring plane is behind the fragment along the sun direction, or past the sun.
  if (t <= 0.0 || t > distToSun) return 1.0;

  vec3 hit = vShadowWorldPos + L * t;
  float r = length(hit - uRingCenterWorld);
  if (r < uRingInnerRadius || r > uRingOuterRadius) return 1.0;

  float u = (r - uRingInnerRadius) / (uRingOuterRadius - uRingInnerRadius);
  float a = texture2D(uRingMap, vec2(u, 0.5)).a;
  return 1.0 - a;
}
`;

export type RingShadowUniforms = {
  uRingMap:         { value: THREE.Texture | null };
  uRingCenterWorld: { value: THREE.Vector3 };
  uRingNormalWorld: { value: THREE.Vector3 };
  uRingInnerRadius: { value: number };
  uRingOuterRadius: { value: number };
};

export function makeRingShadowUniforms(): RingShadowUniforms {
  return {
    uRingMap:         { value: null },
    uRingCenterWorld: { value: new THREE.Vector3() },
    uRingNormalWorld: { value: new THREE.Vector3(0, 1, 0) },
    uRingInnerRadius: { value: 0 },
    uRingOuterRadius: { value: 0 },
  };
}

export function injectRingShadowIntoShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> },
  ringShadowUniforms: Record<string, { value: unknown }>,
): void {
  Object.assign(shader.uniforms, ringShadowUniforms);
  // Insert ring-shadow declarations + function ahead of computeEclipseShadow
  // so the new function sees uSunWorldPos / vShadowWorldPos from SHADOW_FRAG_PARS.
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'float computeEclipseShadow()',
      RING_SHADOW_FRAG_PARS + '\nfloat computeEclipseShadow()',
    )
    .replace(
      'outgoingLight *= computeEclipseShadow();',
      'outgoingLight *= computeEclipseShadow() * computeRingShadow();',
    );
}
