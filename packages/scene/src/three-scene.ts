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
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { PlanetDef } from './planets.ts';
import { buildBodyMaterial, proceduralBodyTexture } from './body-material.ts';
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
  computeOrbitCameraPosition,
  computeTrackCameraPosition,
  type CameraMode as SceneCameraMode,
} from './camera-modes.ts';

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
  private mode: SceneCameraMode = 'orbit';
  private focusVelocity: Km3 = [0, 0, 0];

  private focus = 'Sun';
  private azimuth = 0.6;
  private elevation = 0.35;
  private distance = 3000;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(new Color('#05070b'), 1);
    this.camera = new PerspectiveCamera(45, canvas.width / Math.max(1, canvas.height), 0.01, 1e7);
    this.scene.add(this.world);
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const sun = new PointLight(0xfff4e0, 2.2, 0, 0.0);
    this.world.add(sun);
    // The label overlay sits above the canvas in the same positioned container.
    canvas.parentElement?.appendChild(this.labelLayer.dom);
    this.resize(canvas.width, canvas.height);
  }

  setBodies(defs: readonly PlanetDef[]): void {
    for (const def of defs) {
      const material = buildBodyMaterial(def, {
        loadImageTexture: (url) => this.textureLoader.load(url),
        proceduralTexture: (color) => proceduralBodyTexture(color),
      });
      const radius = def.radiusKm * SCALE;
      const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
      mesh.userData['objectId'] = def.name;
      this.bodies.set(def.name, { def, mesh, radius });
      this.world.add(mesh);
    }
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
      spec.points.forEach((p, i) => {
        coords[i * 3] = p[0] * SCALE;
        coords[i * 3 + 1] = p[1] * SCALE;
        coords[i * 3 + 2] = p[2] * SCALE;
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(coords, 3));
      const material = new LineBasicMaterial({
        color: new Color(spec.color ?? 0x3a5a96),
        transparent: true,
        opacity: 0.45,
      });
      const line = new Line(geometry, material);
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

  setCameraMode(mode: SceneCameraMode): void {
    this.mode = mode;
  }

  get cameraMode(): SceneCameraMode {
    return this.mode;
  }

  setFocusVelocity(velocityKm: Km3): void {
    this.focusVelocity = velocityKm;
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

  centerOn(name: string): void {
    if (this.bodies.has(name) || this.spacecraft?.name === name) this.focus = name;
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
    this.azimuth += dAzimuth;
    const limit = Math.PI / 2 - 0.05;
    this.elevation = Math.max(-limit, Math.min(limit, this.elevation + dElevation));
  }

  zoomBy(factor: number): void {
    this.distance = Math.max(0.5, Math.min(5e6, this.distance * factor));
  }

  setView(azimuth: number, elevation: number, distance: number): void {
    this.azimuth = azimuth;
    this.elevation = elevation;
    this.distance = distance;
  }

  getView(): { focus: string; azimuth: number; elevation: number; distance: number } {
    return {
      focus: this.focus,
      azimuth: this.azimuth,
      elevation: this.elevation,
      distance: this.distance,
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

  render(): void {
    const focusPos = this.positions.get(this.focus) ?? [0, 0, 0];
    this.world.position.set(-focusPos[0] * SCALE, -focusPos[1] * SCALE, -focusPos[2] * SCALE);

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

    const camPos =
      this.mode === 'track'
        ? computeTrackCameraPosition(this.focusVelocity, this.distance)
        : computeOrbitCameraPosition(this.azimuth, this.elevation, this.distance);
    this.camera.position.set(camPos[0], camPos[1], camPos[2]);
    this.camera.lookAt(new Vector3(0, 0, 0));

    // Enforce a minimum apparent size so distant bodies stay visible while the
    // close-up keeps true proportions.
    const cam = this.camera.position;
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
