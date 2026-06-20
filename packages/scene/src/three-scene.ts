// The Phase 0 Three.js scene: textured inner-solar-system globes, a spacecraft
// trajectory polyline, and a moving spacecraft marker, with camera-relative
// (floating-origin) rendering. Body positions arrive as kilometres relative to
// the Sun; every frame the whole world group is translated by minus the focus
// position so the matrices the GPU sees stay small near the focus, defeating
// float32 jitter at solar-system distances (mandatory, CLAUDE.md).

import {
  AmbientLight,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  type Texture,
  TextureLoader,
  ClampToEdgeWrapping,
  RepeatWrapping,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { PlanetDef } from './planets.ts';
import { buildBodyMaterial, cloudShellDescriptor, proceduralBodyTexture } from './body-material.ts';
import { pickObjectId } from './picking.ts';
import { LabelLayer } from './labels.ts';
import { buildParticleSystem, type ParticleSystemParams } from './particle-system.ts';
import { buildKeplerianSwarm, type KeplerianSwarmParams } from './keplerian-swarm.ts';
import { activeSegment, type TimeSegment } from './time-switched.ts';

import {
  SCALE,
  coneTriangleVertices,
  fanTriangleVertices,
  type Km3,
} from './geometry-builders.ts';
import { buildDskMesh } from './dsk-mesh.ts';
import { buildRingMesh } from './rings.ts';
import { buildAxisTriad } from './axis-triad.ts';
import { buildDirectionVectors, type DirectionSpec } from './direction-vectors.ts';
import { buildStarField } from './star-field.ts';
import { type Star } from './star-catalog.ts';
import { buildAtmosphere, type AtmosphereParams } from './atmosphere.ts';
import { buildSunLight } from './shadows.ts';
import { rowMajor3x3ToMatrix4, applyAttitude, applyQuaternion } from './orientation.ts';
import {
  CameraController,
  framingDistance,
  type CameraControlMode,
} from './camera-controller.ts';

export type { Km3 };

// Recursively free GPU resources for an object subtree (geometries and
// materials), so a scene rebuild does not leak buffers.
function disposeDeep(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Partial<Mesh> & Partial<Line>;
    mesh.geometry?.dispose?.();
    const material = (mesh as { material?: unknown }).material;
    if (Array.isArray(material)) {
      for (const m of material) (m as { dispose?: () => void }).dispose?.();
    } else {
      (material as { dispose?: () => void } | undefined)?.dispose?.();
    }
  });
}

// Bodies are kept at true scale; this fraction of the camera-to-body distance is
// the floor on apparent radius so distant planets never collapse to sub-pixel.
const MIN_APPARENT = 0.012;

// Orbit lines keep their true geometry but fade by apparent size, where the
// metric is the orbit's radius over the camera distance to its center (so it
// tracks how much of the frame the ring spans). Tiny rings (distant clutter,
// e.g. a moon orbit seen at solar-system scale) fade in over [IN_LO, IN_HI];
// rings that grow past the frame and would dominate fade out over [OUT_LO,
// OUT_HI]. The camera FOV is 45 deg, so apparent radius ~ frame edge near 0.41.
const ORBIT_FADE_IN_LO = 0.02;
const ORBIT_FADE_IN_HI = 0.06;
const ORBIT_FADE_OUT_LO = 0.45;
const ORBIT_FADE_OUT_HI = 1.6;
const ORBIT_BASE_OPACITY = 0.45;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Opacity multiplier in [0, 1] for an orbit of the given apparent-size ratio. */
export function orbitFade(ratio: number): number {
  return (
    smoothstep(ORBIT_FADE_IN_LO, ORBIT_FADE_IN_HI, ratio) *
    (1 - smoothstep(ORBIT_FADE_OUT_LO, ORBIT_FADE_OUT_HI, ratio))
  );
}

interface BodyNode {
  readonly def: PlanetDef;
  readonly mesh: Mesh;
  /** True radius in scene units. */
  readonly radius: number;
}

export class SolarSystemScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly world = new Group();
  private readonly textureLoader = new TextureLoader();
  private readonly bodies = new Map<string, BodyNode>();
  private hasCloudShell = false;
  private readonly positions = new Map<string, Km3>();
  private readonly raycaster = new Raycaster();
  private readonly labelLayer = new LabelLayer();
  private spacecraft: { name: string; mesh: Object3D; radius: number } | null = null;
  private trajectory: Line | null = null;
  private trajectoryAnchor = 'Sun';
  private readonly orbits: Line[] = [];
  private orbitsVisible = true;
  private fovCone: Mesh | null = null;
  private footprint: Mesh | null = null;
  private footprintAnchor = 'Saturn';
  // Reference-frame axis triads (Batch B, Task 9) and star field (Task 15) attach
  // here; the visibility seams below already gate them so toggles work once added.
  private readonly axes = new Map<string, Object3D>();
  private axesVisible = true;
  private starField: Object3D | null = null;
  private starFieldVisible = true;
  private dskMesh: Mesh | null = null;
  private rings: Object3D | null = null;
  private readonly particleSystems = new Map<string, Object3D>();
  private readonly swarms = new Map<string, Object3D>();
  private readonly timeSwitched = new Map<
    string,
    { group: Object3D; markers: Object3D[]; segments: TimeSegment[] }
  >();
  private particlesVisible = true;
  private swarmsVisible = true;
  private directionVectors: Object3D | null = null;
  private atmosphere: Object3D | null = null;
  private spacecraftModel: Object3D | null = null;
  // The inner model object that CK attitude rotates (the wrapper keeps position).
  private spacecraftAttitudeTarget: Object3D | null = null;
  // Objects that track a body each frame (rings, axes, DSK mesh, direction vectors).
  private readonly anchored = new Map<Object3D, string>();
  private readonly controller = new CameraController();
  private focusVelocity: Km3 = [0, 0, 0];
  private syncFrame: readonly number[] | null = null;
  // The arbitrary SPICE-frame -> J2000 rotation for 'frame' camera mode (lock the
  // camera basis to e.g. IAU_EARTH or a mission frame), refreshed by the engine.
  private cameraFrame: readonly number[] | null = null;
  private focus = 'Sun';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setClearColor(new Color('#05070b'), 1);
    // A small near plane (the logarithmic depth buffer keeps precision across the
    // huge near:far ratio) lets the camera frame small bodies and spacecraft.
    this.camera = new PerspectiveCamera(45, canvas.width / Math.max(1, canvas.height), 1e-4, 1e7);
    this.scene.add(this.world);
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const sun = new PointLight(0xfff4e0, 2.2, 0, 0.0);
    this.world.add(sun);
    // The label overlay sits above the canvas in the same positioned container.
    canvas.parentElement?.appendChild(this.labelLayer.dom);
    this.resize(canvas.width, canvas.height);
  }

  setBodies(defs: readonly PlanetDef[]): void {
    this.hasCloudShell = false;
    for (const def of defs) {
      const material = buildBodyMaterial(def, {
        loadImageTexture: (url) => this.textureLoader.load(url),
        proceduralTexture: (color) => proceduralBodyTexture(color),
      });
      const radius = def.radiusKm * SCALE;
      const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
      mesh.userData['objectId'] = def.name;
      // Cloud layer: a separate translucent shell above the surface, so clouds
      // alpha-blend over the globe rather than baking into the base material.
      const cloud = cloudShellDescriptor(def);
      if (cloud) {
        const cloudMap = this.textureLoader.load(cloud.cloudMap);
        const shell = new Mesh(
          new SphereGeometry(radius + cloud.altitudeKm * SCALE, 32, 16),
          new MeshBasicMaterial({
            map: cloudMap,
            transparent: true,
            depthWrite: false,
            opacity: 1.0,
          }),
        );
        shell.userData['cloudShell'] = true;
        mesh.add(shell);
        this.hasCloudShell = true;
      }
      this.bodies.set(def.name, { def, mesh, radius });
      this.world.add(mesh);
    }
  }

  /** True when the last setBodies built at least one cloud shell (read for the HUD flag). */
  cloudShellPresent(): boolean {
    return this.hasCloudShell;
  }

  /** The known body names in the current scene (so a texture manager can target them). */
  bodyNames(): string[] {
    return [...this.bodies.keys()];
  }

  /**
   * Swap a body's diffuse map to a loaded equirectangular image (real imagery),
   * replacing the procedural fallback in place. The base-map wraps in longitude
   * and clamps at the poles, matching the procedural setup. No-op for an unknown
   * body; the old map is disposed so the swap does not leak a GPU texture.
   */
  setBodyTexture(name: string, texture: Texture): boolean {
    const node = this.bodies.get(name);
    if (!node) return false;
    const material = node.mesh.material as MeshStandardMaterial;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    const previous = material.map;
    material.map = texture;
    material.needsUpdate = true;
    if (previous && previous !== texture) previous.dispose();
    return true;
  }

  setSpacecraft(name: string, radiusKm = 200): void {
    const material = new MeshStandardMaterial({
      color: new Color('#e6e9ef'),
      emissive: new Color('#9fb4ff'),
      emissiveIntensity: 0.6,
    });
    const radius = radiusKm * SCALE;
    const mesh = new Mesh(new SphereGeometry(radius, 12, 8), material);
    mesh.userData['objectId'] = name;
    this.spacecraft = { name, mesh, radius };
    this.world.add(mesh);
  }

  /**
   * Set the trajectory polyline. Points are km relative to anchorBody, and the
   * line is positioned at the anchor body every frame, so a spacecraft orbit
   * sampled in its central body's frame stays attached to that body.
   */
  setTrajectory(
    points: readonly Km3[],
    anchorBody = 'Sun',
    colors?: readonly (readonly [number, number, number])[],
  ): void {
    this.trajectoryAnchor = anchorBody;
    if (this.trajectory) {
      this.world.remove(this.trajectory);
      this.trajectory.geometry.dispose();
    }
    const coords = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      coords[i * 3] = p[0] * SCALE;
      coords[i * 3 + 1] = p[1] * SCALE;
      coords[i * 3 + 2] = p[2] * SCALE;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(coords, 3));
    let material: LineBasicMaterial;
    if (colors && colors.length === points.length) {
      // Per-vertex colors let a strategy (e.g. @bessel/color colorByDistance) fade
      // the trail along its length.
      const colorArr = new Float32Array(points.length * 3);
      colors.forEach((c, i) => {
        colorArr[i * 3] = c[0];
        colorArr[i * 3 + 1] = c[1];
        colorArr[i * 3 + 2] = c[2];
      });
      geometry.setAttribute('color', new Float32BufferAttribute(colorArr, 3));
      material = new LineBasicMaterial({ vertexColors: true });
    } else {
      material = new LineBasicMaterial({ color: new Color('#5b8cff') });
    }
    this.trajectory = new Line(geometry, material);
    this.world.add(this.trajectory);
  }

  /** Draw orbit path polylines (km, relative to each orbit's central body). */
  setOrbits(
    specs: readonly { id: string; anchorBody: string; points: readonly Km3[]; color?: number }[],
  ): void {
    for (const line of this.orbits) {
      this.replaceAnchored(line, null, '');
      line.geometry.dispose();
    }
    this.orbits.length = 0;
    for (const spec of specs) {
      if (spec.points.length < 2) continue;
      const coords = new Float32Array(spec.points.length * 3);
      let maxRadiusKm = 0;
      spec.points.forEach((p, i) => {
        coords[i * 3] = p[0] * SCALE;
        coords[i * 3 + 1] = p[1] * SCALE;
        coords[i * 3 + 2] = p[2] * SCALE;
        const r = Math.hypot(p[0], p[1], p[2]);
        if (r > maxRadiusKm) maxRadiusKm = r;
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(coords, 3));
      const material = new LineBasicMaterial({
        color: new Color(spec.color ?? 0x3a5a96),
        transparent: true,
        opacity: ORBIT_BASE_OPACITY,
      });
      const line = new Line(geometry, material);
      // Carry the apoapsis radius (world units) and anchor so render() can fade
      // the ring by its apparent size each frame.
      line.userData['orbitRadius'] = maxRadiusKm * SCALE;
      line.userData['anchorBody'] = spec.anchorBody;
      line.visible = this.orbitsVisible;
      this.replaceAnchored(null, line, spec.anchorBody);
      this.orbits.push(line);
    }
  }

  setOrbitsVisible(visible: boolean): void {
    this.orbitsVisible = visible;
    for (const line of this.orbits) line.visible = visible;
  }

  /**
   * Set the sensor FOV cone: apex and rim points are km relative to the Sun (the
   * same frame as bodies), so the cone tracks the spacecraft each frame.
   */
  setFovCone(apex: Km3, rim: readonly Km3[], color = '#33ccff'): void {
    if (this.fovCone) {
      this.world.remove(this.fovCone);
      this.fovCone.geometry.dispose();
    }
    if (rim.length < 3) {
      this.fovCone = null;
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(coneTriangleVertices(apex, rim), 3));
    geometry.computeVertexNormals();
    const material = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity: 0.25,
      side: DoubleSide,
      depthWrite: false,
    });
    this.fovCone = new Mesh(geometry, material);
    this.world.add(this.fovCone);
  }

  /**
   * Set the observation footprint as a filled translucent patch (km relative to
   * anchorBody). A triangle fan around the centroid gives the footprint area so it
   * reads as a surface region rather than a hairline.
   */
  setFootprint(points: readonly Km3[], anchorBody = 'Saturn', color = '#ffcc00'): void {
    this.footprintAnchor = anchorBody;
    if (this.footprint) {
      this.world.remove(this.footprint);
      this.footprint.geometry.dispose();
    }
    if (points.length < 3) {
      this.footprint = null;
      return;
    }
    // Lift the patch a little above the surface (relative to the anchor centre) so
    // it does not z-fight the globe, and draw it on top so it reads as a highlight.
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(fanTriangleVertices(points, SCALE, 1.02), 3));
    this.footprint = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: 0.6,
        side: DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.footprint.renderOrder = 3;
    this.world.add(this.footprint);
  }

  private replaceAnchored(prev: Object3D | null, next: Object3D | null, anchorBody: string): void {
    if (prev) {
      this.world.remove(prev);
      this.anchored.delete(prev);
    }
    if (next) {
      this.anchored.set(next, anchorBody);
      this.world.add(next);
    }
  }

  /** Render a DSK shape-model mesh anchored at a body, oriented by a pxform 3x3. */
  setDskMesh(
    name: string,
    anchorBody: string,
    vertices: readonly number[],
    plates: readonly number[],
    rotationRowMajor3x3?: readonly number[],
    scale?: number,
  ): void {
    const mesh = buildDskMesh(vertices, plates, undefined, scale);
    mesh.name = name;
    if (rotationRowMajor3x3) mesh.setRotationFromMatrix(rowMajor3x3ToMatrix4(rotationRowMajor3x3));
    this.replaceAnchored(this.dskMesh, mesh, anchorBody);
    this.dskMesh = mesh;
  }

  /** Render planetary rings anchored at a body, oriented by a pxform 3x3. */
  setRings(
    anchorBody: string,
    innerRadiusKm: number,
    outerRadiusKm: number,
    rotationRowMajor3x3?: readonly number[],
    texture?: string,
  ): void {
    const map = texture ? this.textureLoader.load(texture) : undefined;
    const mesh = buildRingMesh(innerRadiusKm, outerRadiusKm, undefined, map);
    if (rotationRowMajor3x3) mesh.setRotationFromMatrix(rowMajor3x3ToMatrix4(rotationRowMajor3x3));
    this.replaceAnchored(this.rings, mesh, anchorBody);
    this.rings = mesh;
  }

  /** Render an RGB reference-frame axis triad anchored at a body. */
  setAxisTriad(
    name: string,
    anchorBody: string,
    rotationRowMajor3x3: readonly number[],
    lengthKm: number,
  ): void {
    const triad = buildAxisTriad(lengthKm);
    triad.setRotationFromMatrix(rowMajor3x3ToMatrix4(rotationRowMajor3x3));
    triad.visible = this.axesVisible;
    this.replaceAnchored(this.axes.get(name) ?? null, triad, anchorBody);
    this.axes.set(name, triad);
  }

  /** Render labeled direction arrows anchored at a body. */
  setDirectionVectors(anchorBody: string, specs: readonly DirectionSpec[], lengthKm: number): void {
    const group = buildDirectionVectors(specs, lengthKm * SCALE);
    this.replaceAnchored(this.directionVectors, group, anchorBody);
    this.directionVectors = group;
  }

  /** Replace the particle systems (plumes, dust), each anchored at a body. */
  setParticleSystems(
    specs: readonly {
      id: string;
      anchorBody: string;
      params: ParticleSystemParams;
      rotationRowMajor3x3?: readonly number[];
    }[],
  ): void {
    for (const obj of this.particleSystems.values()) this.replaceAnchored(obj, null, '');
    this.particleSystems.clear();
    for (const spec of specs) {
      const points = buildParticleSystem(spec.params);
      if (spec.rotationRowMajor3x3) {
        points.setRotationFromMatrix(rowMajor3x3ToMatrix4(spec.rotationRowMajor3x3));
      }
      points.visible = this.particlesVisible;
      this.replaceAnchored(null, points, spec.anchorBody);
      this.particleSystems.set(spec.id, points);
    }
  }

  setParticleSystemsVisible(visible: boolean): void {
    this.particlesVisible = visible;
    for (const obj of this.particleSystems.values()) obj.visible = visible;
  }

  /** Replace the Keplerian swarms (belts, ring particles), each anchored at a body. */
  setKeplerianSwarms(
    specs: readonly {
      id: string;
      anchorBody: string;
      params: KeplerianSwarmParams;
      rotationRowMajor3x3?: readonly number[];
    }[],
  ): void {
    for (const obj of this.swarms.values()) this.replaceAnchored(obj, null, '');
    this.swarms.clear();
    for (const spec of specs) {
      const points = buildKeplerianSwarm(spec.params);
      if (spec.rotationRowMajor3x3) {
        points.setRotationFromMatrix(rowMajor3x3ToMatrix4(spec.rotationRowMajor3x3));
      }
      points.visible = this.swarmsVisible;
      this.replaceAnchored(null, points, spec.anchorBody);
      this.swarms.set(spec.id, points);
    }
  }

  setKeplerianSwarmsVisible(visible: boolean): void {
    this.swarmsVisible = visible;
    for (const obj of this.swarms.values()) obj.visible = visible;
  }

  /**
   * Replace the time-switched markers. Each spec is a stack of colored markers
   * (one per time segment) offset above a body; updateTimeSwitched shows only the
   * marker whose segment is active at the current epoch.
   */
  setTimeSwitched(
    specs: readonly {
      id: string;
      anchorBody: string;
      offsetKm?: number;
      segments: readonly { start: number; end: number; color: string; radiusKm?: number }[];
    }[],
  ): void {
    for (const entry of this.timeSwitched.values()) this.replaceAnchored(entry.group, null, '');
    this.timeSwitched.clear();
    for (const spec of specs) {
      const group = new Group();
      const markers: Object3D[] = [];
      const segments: TimeSegment[] = [];
      const offset = (spec.offsetKm ?? 0) * SCALE;
      for (const seg of spec.segments) {
        const radius = (seg.radiusKm ?? 15000) * SCALE;
        const marker = new Mesh(
          new SphereGeometry(radius, 12, 8),
          new MeshBasicMaterial({ color: new Color(seg.color) }),
        );
        marker.position.set(0, offset, 0);
        marker.visible = false;
        group.add(marker);
        markers.push(marker);
        segments.push({ start: seg.start, end: seg.end });
      }
      this.replaceAnchored(null, group, spec.anchorBody);
      this.timeSwitched.set(spec.id, { group, markers, segments });
    }
  }

  /** Show only the marker whose segment contains et (called each frame). */
  updateTimeSwitched(et: number): void {
    for (const entry of this.timeSwitched.values()) {
      const idx = activeSegment(entry.segments, et);
      entry.markers.forEach((marker, i) => {
        marker.visible = i === idx;
      });
    }
  }

  /** Render an atmosphere limb-glow shell anchored at a body. */
  setAtmosphere(
    anchorBody: string,
    planetRadiusKm: number,
    atmosphereRadiusKm: number,
    params: AtmosphereParams,
  ): void {
    const mesh = buildAtmosphere(planetRadiusKm, atmosphereRadiusKm, params);
    this.replaceAnchored(this.atmosphere, mesh, anchorBody);
    this.atmosphere = mesh;
  }

  /** Render a star field on the celestial sphere (parented to the camera). */
  setStarField(stars: readonly Star[]): void {
    if (this.starField) this.camera.remove(this.starField);
    const points = buildStarField(stars);
    points.visible = this.starFieldVisible;
    this.starField = points;
    // Parent to the camera so stars stay at infinity regardless of the focus shift.
    this.camera.add(points);
    if (!this.scene.children.includes(this.camera)) this.scene.add(this.camera);
  }

  /**
   * Replace the spacecraft marker with a loaded model (keeps the marker on
   * failure). The model is wrapped in a group so the per-frame apparent-size scale
   * is applied to the wrapper while the model keeps its own normalization scale.
   */
  setSpacecraftModel(object: Object3D): void {
    if (!this.spacecraft) return;
    if (this.spacecraftModel) this.world.remove(this.spacecraftModel);
    this.world.remove(this.spacecraft.mesh);
    const wrapper = new Group();
    wrapper.add(object);
    wrapper.position.copy(this.spacecraft.mesh.position);
    this.spacecraftModel = wrapper;
    this.spacecraftAttitudeTarget = object;
    this.spacecraft = { ...this.spacecraft, mesh: wrapper };
    this.world.add(wrapper);
  }

  /**
   * Orient the spacecraft model from a SPICE row-major rotation (CK attitude).
   * No-op when no model is loaded; the wrapper keeps the position and apparent
   * size, so only the model's orientation changes.
   */
  setSpacecraftAttitude(rotationRowMajor3x3: readonly number[]): void {
    if (this.spacecraftAttitudeTarget) applyAttitude(this.spacecraftAttitudeTarget, rotationRowMajor3x3);
  }

  /** Orient the spacecraft model by a quaternion (Fixed or UniformRotation attitude). */
  setSpacecraftAttitudeQuaternion(q: readonly [number, number, number, number]): void {
    if (this.spacecraftAttitudeTarget) applyQuaternion(this.spacecraftAttitudeTarget, q);
  }

  /** Physical radius (km) of the focused body, for sizing the shadow frustum etc. */
  focusBodyRadiusKm(): number {
    return this.bodies.get(this.focus)?.def.radiusKm ?? 1000;
  }

  /** Enable sun-cast shadow mapping (replaces the ambient point light). */
  enableShadows(bodyRadiusKm: number): void {
    this.renderer.shadowMap.enabled = true;
    const light = buildSunLight(bodyRadiusKm * SCALE, 2000);
    this.world.add(light);
    for (const node of this.bodies.values()) {
      node.mesh.castShadow = true;
      node.mesh.receiveShadow = true;
    }
    if (this.dskMesh) {
      this.dskMesh.castShadow = true;
      this.dskMesh.receiveShadow = true;
    }
  }

  setCameraMode(mode: CameraControlMode): void {
    this.controller.setMode(mode);
  }

  get cameraMode(): CameraControlMode {
    return this.controller.mode;
  }

  setFocusVelocity(velocityKm: Km3): void {
    this.focusVelocity = velocityKm;
  }

  /** Body-fixed -> J2000 rotation (3x3 row-major) used by sync-orbit mode. */
  setSyncFrame(matrix: readonly number[] | null): void {
    this.syncFrame = matrix;
  }

  /** Arbitrary SPICE-frame -> J2000 rotation (3x3 row-major) for 'frame' mode. */
  setCameraFrame(matrix: readonly number[] | null): void {
    this.cameraFrame = matrix;
  }

  /** Pan (truck) the view in the screen plane, as a fraction of the distance. */
  panBy(dxFraction: number, dyFraction: number): void {
    this.controller.panBy(dxFraction, dyFraction);
  }

  /** Dolly: translate the camera forward/back along its view axis (Cosmographia). */
  dollyBy(forwardFraction: number): void {
    this.controller.dollyBy(forwardFraction);
  }

  /** Crane: translate the viewpoint vertically (Cosmographia craneUp / craneDown). */
  craneBy(upFraction: number): void {
    this.controller.craneBy(upFraction);
  }

  rollBy(dRoll: number): void {
    this.controller.rollBy(dRoll);
  }

  /** Multiply the field of view (telephoto when < 1, wide when > 1). */
  fovBy(factor: number): void {
    this.controller.fovBy(factor);
  }

  /** Translate the free-fly camera along its own axes (scene units). */
  flyMove(forward: number, right: number, up: number): void {
    this.controller.flyMove(forward, right, up);
  }

  /** Current (damped) vertical field of view in degrees. */
  get cameraFovDeg(): number {
    return this.controller.fovValue;
  }

  /** Distance (scene units) of the free-fly camera from the view center. */
  get freeRadius(): number {
    return this.controller.freeRadius;
  }

  setCameraFov(fovDeg: number, animate = false): void {
    this.controller.setFovDeg(fovDeg, animate);
  }

  /** Update body and spacecraft positions (km relative to the Sun). */
  setPositions(positions: ReadonlyMap<string, Km3>): void {
    for (const [name, pos] of positions) {
      this.positions.set(name, pos);
      const node = this.bodies.get(name);
      if (node) node.mesh.position.set(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);
      if (this.spacecraft && this.spacecraft.name === name) {
        this.spacecraft.mesh.position.set(pos[0] * SCALE, pos[1] * SCALE, pos[2] * SCALE);
      }
    }
  }

  /** Toggle a body or spacecraft node visibility (and its trajectory). */
  setVisible(name: string, visible: boolean): void {
    const body = this.bodies.get(name);
    if (body) body.mesh.visible = visible;
    if (this.spacecraft && this.spacecraft.name === name) {
      this.spacecraft.mesh.visible = visible;
    }
  }

  setTrajectoryVisible(visible: boolean): void {
    if (this.trajectory) this.trajectory.visible = visible;
  }

  setFovVisible(visible: boolean): void {
    if (this.fovCone) this.fovCone.visible = visible;
  }

  setFootprintVisible(visible: boolean): void {
    if (this.footprint) this.footprint.visible = visible;
  }

  setAxesVisible(visible: boolean): void {
    this.axesVisible = visible;
    for (const group of this.axes.values()) group.visible = visible;
  }

  setStarFieldVisible(visible: boolean): void {
    this.starFieldVisible = visible;
    if (this.starField) this.starField.visible = visible;
  }

  setAtmosphereVisible(visible: boolean): void {
    if (this.atmosphere) this.atmosphere.visible = visible;
  }

  /**
   * Focus a body and frame it. The view center glides to the body (fly-to) and
   * the distance is computed from the body's radius (Sun frames the whole system).
   * Pass animate=false to snap (scene (re)build / boot).
   */
  centerOn(name: string, animate = true): void {
    if (!(this.bodies.has(name) || this.spacecraft?.name === name)) return;
    this.focus = name;
    if (animate) this.controller.flyTo();
    else {
      const pos = this.positions.get(name) ?? [0, 0, 0];
      this.controller.snapCenter(pos);
    }
    this.controller.setView(0.6, 0.35, this.framingDistance(name), animate);
  }

  /** Distance (scene units) that frames a body; the Sun frames the whole system. */
  private framingDistance(name: string): number {
    if (name === 'Sun') return 7000;
    const radius = this.bodies.get(name)?.radius ?? this.spacecraft?.radius ?? 0;
    if (radius <= 0) return 600;
    return framingDistance(radius, this.controller.fovValue);
  }

  /**
   * Pick the nearest body or spacecraft under a normalized device coordinate
   * (x, y in [-1, 1]). Returns the objectId, or null if the ray misses. Uses the
   * meshes as rendered (camera-relative, apparent-size scaled), so it matches
   * what the user sees on screen.
   */
  pickObjectAt(ndcX: number, ndcY: number): string | null {
    const candidates: Object3D[] = [];
    for (const node of this.bodies.values()) {
      if (node.mesh.visible) candidates.push(node.mesh);
    }
    if (this.spacecraft && this.spacecraft.mesh.visible) candidates.push(this.spacecraft.mesh);
    return pickObjectId(this.raycaster, this.camera, ndcX, ndcY, candidates);
  }

  get focusBody(): string {
    return this.focus;
  }

  orbitBy(dAzimuth: number, dElevation: number): void {
    this.controller.orbitBy(dAzimuth, dElevation);
  }

  zoomBy(factor: number): void {
    this.controller.zoomBy(factor);
  }

  setView(azimuth: number, elevation: number, distance: number, animate = false): void {
    this.controller.setView(azimuth, elevation, distance, animate);
  }

  getView(): { focus: string; azimuth: number; elevation: number; distance: number } {
    return {
      focus: this.focus,
      azimuth: this.controller.azimuthValue,
      elevation: this.controller.elevationValue,
      distance: this.controller.distance,
    };
  }

  /** Attach name labels to bodies or the spacecraft, anchored by object name. */
  setLabels(specs: readonly { id: string; text: string; anchorBody: string }[]): void {
    const targets = [];
    for (const spec of specs) {
      const object =
        this.bodies.get(spec.anchorBody)?.mesh ??
        (this.spacecraft?.name === spec.anchorBody ? this.spacecraft.mesh : null);
      if (object) targets.push({ id: spec.id, text: spec.text, object });
    }
    this.labelLayer.setLabels(targets);
  }

  setLabelsVisible(visible: boolean): void {
    this.labelLayer.setVisible(visible);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.labelLayer.setSize(width, height);
  }

  render(dt = 0): void {
    const focusPos = this.positions.get(this.focus) ?? [0, 0, 0];
    // sync locks to the body IAU frame; frame locks to an arbitrary SPICE frame.
    const lockFrame =
      this.cameraMode === 'sync'
        ? this.syncFrame
        : this.cameraMode === 'frame'
          ? this.cameraFrame
          : null;
    const pose = this.controller.step({
      dt,
      focusPos,
      focusVelocity: this.focusVelocity,
      bodyFrame: lockFrame ?? undefined,
    });
    this.world.position.set(-pose.center[0] * SCALE, -pose.center[1] * SCALE, -pose.center[2] * SCALE);

    if (this.trajectory) {
      const anchor = this.positions.get(this.trajectoryAnchor) ?? [0, 0, 0];
      this.trajectory.position.set(anchor[0] * SCALE, anchor[1] * SCALE, anchor[2] * SCALE);
    }
    if (this.footprint) {
      const anchor = this.positions.get(this.footprintAnchor) ?? [0, 0, 0];
      this.footprint.position.set(anchor[0] * SCALE, anchor[1] * SCALE, anchor[2] * SCALE);
    }
    for (const [obj, anchorBody] of this.anchored) {
      const anchor = this.positions.get(anchorBody) ?? [0, 0, 0];
      obj.position.set(anchor[0] * SCALE, anchor[1] * SCALE, anchor[2] * SCALE);
    }

    this.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    this.camera.up.set(pose.up[0], pose.up[1], pose.up[2]);
    this.camera.lookAt(new Vector3(pose.target[0], pose.target[1], pose.target[2]));
    if (Math.abs(this.camera.fov - pose.fov) > 1e-3) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }

    // Enforce a minimum apparent size so distant bodies stay visible while the
    // close-up keeps true proportions.
    const cam = this.camera.position;

    // Fade orbit rings by apparent size: invisible when they shrink to clutter
    // or grow large enough to dominate the frame, full opacity in between. The
    // geometry stays true scale; only opacity changes.
    for (const line of this.orbits) {
      if (!line.visible) continue;
      const radius = (line.userData['orbitRadius'] as number) ?? 0;
      const anchor = this.positions.get(line.userData['anchorBody'] as string) ?? [0, 0, 0];
      const ax = this.world.position.x + anchor[0] * SCALE - cam.x;
      const ay = this.world.position.y + anchor[1] * SCALE - cam.y;
      const az = this.world.position.z + anchor[2] * SCALE - cam.z;
      const dist = Math.sqrt(ax * ax + ay * ay + az * az);
      const ratio = dist > 1e-9 ? radius / dist : 0;
      (line.material as LineBasicMaterial).opacity = ORBIT_BASE_OPACITY * orbitFade(ratio);
    }

    const apply = (mesh: Object3D, radius: number): void => {
      const dx = this.world.position.x + mesh.position.x - cam.x;
      const dy = this.world.position.y + mesh.position.y - cam.y;
      const dz = this.world.position.z + mesh.position.z - cam.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const floor = dist * MIN_APPARENT;
      mesh.scale.setScalar(radius > 0 ? Math.max(1, floor / radius) : 1);
    };
    for (const node of this.bodies.values()) apply(node.mesh, node.radius);
    if (this.spacecraft) apply(this.spacecraft.mesh, this.spacecraft.radius);

    this.renderer.render(this.scene, this.camera);
    this.labelLayer.update(this.camera);
  }

  /**
   * Remove all mission content (bodies, spacecraft, trajectory, decorations,
   * labels) while keeping the renderer, camera, lights, and label overlay, so a
   * newly loaded catalog can repopulate the same scene without duplicating the
   * previous mission. This is the seam engine.loadCatalog uses to re-render an
   * arbitrary mission in place.
   */
  reset(): void {
    const drop = (obj: Object3D | null): void => {
      if (!obj) return;
      this.world.remove(obj);
      disposeDeep(obj);
    };
    for (const node of this.bodies.values()) drop(node.mesh);
    this.bodies.clear();
    this.positions.clear();
    drop(this.spacecraft?.mesh ?? null);
    this.spacecraft = null;
    drop(this.spacecraftModel);
    this.spacecraftModel = null;
    this.spacecraftAttitudeTarget = null;
    drop(this.trajectory);
    this.trajectory = null;
    for (const line of this.orbits) drop(line);
    this.orbits.length = 0;
    drop(this.fovCone);
    this.fovCone = null;
    drop(this.footprint);
    this.footprint = null;
    drop(this.starField);
    this.starField = null;
    drop(this.dskMesh);
    this.dskMesh = null;
    drop(this.rings);
    this.rings = null;
    drop(this.directionVectors);
    this.directionVectors = null;
    drop(this.atmosphere);
    this.atmosphere = null;
    for (const obj of this.axes.values()) drop(obj);
    this.axes.clear();
    for (const obj of this.particleSystems.values()) drop(obj);
    this.particleSystems.clear();
    for (const obj of this.swarms.values()) drop(obj);
    this.swarms.clear();
    for (const entry of this.timeSwitched.values()) drop(entry.group);
    this.timeSwitched.clear();
    this.anchored.clear();
    this.labelLayer.setLabels([]);
  }

  dispose(): void {
    this.labelLayer.dispose();
    this.renderer.dispose();
  }
}
