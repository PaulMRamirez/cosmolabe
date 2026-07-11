// Coverage figure-of-merit overlay: a vertex-colored mesh draped on a body sphere,
// one colored quad per grid cell, colored by a viridis-like colormap over the cell's
// scalar FOM (0..1). Pure geometry + color, separated from the WebGL scene so it is
// unit tested headlessly; the scene wraps the result in a Mesh and anchors it to the
// body each frame (camera-relative, the same floating-origin pattern as rings and the
// footprint patch). @bessel/scene stays SPICE-free: the input is a plain data spec
// (lat/lon cell centers + scalar FOM), not a SPICE CoverageGrid.

import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { SCALE } from './geometry-builders.ts';
import { viridis } from './colormap.ts';

/** One cell of the overlay: its center (rad) and scalar figure of merit in [0, 1]. */
export interface CoverageOverlayCell {
  readonly latRad: number;
  readonly lonRad: number;
  /** Figure of merit in [0, 1], reduced (e.g. percentCoverage) before it reaches here. */
  readonly fom: number;
}

/** A plain, SPICE-free description of a coverage overlay to drape on a body sphere. */
export interface CoverageOverlaySpec {
  /** Body the overlay is draped on (the anchor whose position the scene tracks). */
  readonly anchorBody: string;
  /** Equatorial surface radius (km) of the body the grid sits on. */
  readonly bodyRadiusKm: number;
  /** Polar surface radius (km) for an oblate body; defaults to bodyRadiusKm (a sphere) when
   *  absent, so an oblate body's pole cells sit on the (a, a, c) ellipsoid, not a sphere. */
  readonly polarRadiusKm?: number;
  /** Number of latitude rows and longitude columns the cell centers form. */
  readonly latCount: number;
  readonly lonCount: number;
  /** Cells in row-major order (row by latitude, column by longitude). */
  readonly cells: readonly CoverageOverlayCell[];
  /** Lift fraction above the surface so the patch does not z-fight the globe (default 1.01). */
  readonly liftFraction?: number;
}

/** A located, typed error for a malformed overlay spec (fail loudly, CLAUDE.md). */
export class CoverageOverlayError extends Error {
  constructor(message: string) {
    super(`coverage overlay: ${message}`);
    this.name = 'CoverageOverlayError';
  }
}

/** The non-indexed triangle geometry (positions + per-vertex colors) of an overlay. */
export interface OverlayBuffers {
  /** Triangle vertex positions (scene units, body-relative), 3 per vertex. */
  readonly positions: Float32Array;
  /** Per-vertex linear RGB colors, 3 per vertex, parallel to positions. */
  readonly colors: Float32Array;
  /** Number of vertices (positions.length / 3); two triangles (6 verts) per cell. */
  readonly vertexCount: number;
}

// A point on the body ellipsoid (scene units, body-centered) from lat/lon: the equatorial
// (x, z plane) is scaled by `equRadius`, the polar (y) axis by `polRadius`. With the two equal
// this is a sphere; on an oblate body (polRadius < equRadius) the pole cells sit closer to the
// center, so the draped overlay follows the flattening instead of detaching at the poles.
function spherePoint(
  latRad: number,
  lonRad: number,
  equRadius: number,
  polRadius: number,
): [number, number, number] {
  const cosLat = Math.cos(latRad);
  return [
    equRadius * cosLat * Math.cos(lonRad),
    polRadius * Math.sin(latRad),
    equRadius * cosLat * Math.sin(lonRad),
  ];
}

/**
 * Build the draped overlay buffers from a spec: one colored quad (two triangles) per
 * cell, placed on the body sphere from the cell-center grid, vertex-colored by viridis
 * over each cell's FOM. The quad spans half a step toward each neighbor so adjacent
 * cells tile the surface. Positions are body-relative scene units (km * SCALE), so the
 * scene only translates by the (camera-relative) anchor position each frame and never
 * feeds raw solar-system coordinates to the GPU. Throws CoverageOverlayError on a
 * malformed spec (bad counts, wrong cell length, non-positive radius).
 */
export function buildCoverageOverlayBuffers(spec: CoverageOverlaySpec): OverlayBuffers {
  const { latCount, lonCount, cells, bodyRadiusKm } = spec;
  if (!Number.isInteger(latCount) || !Number.isInteger(lonCount) || latCount < 1 || lonCount < 1) {
    throw new CoverageOverlayError(`latCount and lonCount must be positive integers (got ${latCount}, ${lonCount})`);
  }
  if (cells.length !== latCount * lonCount) {
    throw new CoverageOverlayError(`expected ${latCount * lonCount} cells, got ${cells.length}`);
  }
  if (!(bodyRadiusKm > 0)) {
    throw new CoverageOverlayError(`bodyRadiusKm must be positive (got ${bodyRadiusKm})`);
  }
  const polarRadiusKm = spec.polarRadiusKm ?? bodyRadiusKm;
  if (!(polarRadiusKm > 0)) {
    throw new CoverageOverlayError(`polarRadiusKm must be positive (got ${polarRadiusKm})`);
  }
  const lift = spec.liftFraction ?? 1.01;
  const equRadius = bodyRadiusKm * SCALE * lift;
  const polRadius = polarRadiusKm * SCALE * lift;

  // Half the spacing to each neighbor, so quads centered on cell centers tile. With one
  // row/column the cell spans a small fixed patch rather than collapsing to a line.
  const latStep = latCount > 1 ? halfSpacing(cells, lonCount, true) : 0.2;
  const lonStep = lonCount > 1 ? halfSpacing(cells, lonCount, false) : 0.2;

  const positions: number[] = [];
  const colors: number[] = [];
  for (const cell of cells) {
    const lat0 = cell.latRad - latStep;
    const lat1 = cell.latRad + latStep;
    const lon0 = cell.lonRad - lonStep;
    const lon1 = cell.lonRad + lonStep;
    // Quad corners on the ellipsoid: (lat0,lon0), (lat0,lon1), (lat1,lon1), (lat1,lon0).
    const c00 = spherePoint(lat0, lon0, equRadius, polRadius);
    const c01 = spherePoint(lat0, lon1, equRadius, polRadius);
    const c11 = spherePoint(lat1, lon1, equRadius, polRadius);
    const c10 = spherePoint(lat1, lon0, equRadius, polRadius);
    const rgb = viridis(cell.fom);
    // Two triangles per quad (CCW): (c00,c01,c11) and (c00,c11,c10).
    for (const corner of [c00, c01, c11, c00, c11, c10]) {
      positions.push(corner[0], corner[1], corner[2]);
      colors.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    vertexCount: positions.length / 3,
  };
}

// Half the center-to-center spacing along latitude (rows) or longitude (columns), from
// the first two distinct centers. Cells are row-major: column step is between cells 0
// and 1; row step is between cells 0 and lonCount.
function halfSpacing(cells: readonly CoverageOverlayCell[], lonCount: number, alongLat: boolean): number {
  const a = cells[0]!;
  const b = alongLat ? cells[lonCount] : cells[1];
  if (!b) return 0.1;
  const d = alongLat ? Math.abs(b.latRad - a.latRad) : Math.abs(b.lonRad - a.lonRad);
  return (d > 1e-9 ? d : 0.2) / 2;
}

/** Build a draped, vertex-colored overlay Mesh from a spec (the scene anchors it). */
export function buildCoverageOverlayMesh(spec: CoverageOverlaySpec): Mesh {
  const buffers = buildCoverageOverlayBuffers(spec);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(buffers.colors, 3));
  geometry.computeVertexNormals();
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  // Draw over the globe so the FOM reads as a highlight rather than fighting the surface.
  mesh.renderOrder = 2;
  return mesh;
}
