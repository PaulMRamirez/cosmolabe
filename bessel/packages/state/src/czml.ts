// CZML export for CesiumJS interop (docs/integrations.md Section 4, SPEC Phase 2).
// An interchange format, not a live link: Bessel exports a selected object's
// trajectory over a time window as a CZML document plus a position-sampled entity.
// CZML positions are Cartesian metres; Bessel samples are kilometres.

export interface CzmlSample {
  /** ISO 8601 UTC time of the sample. */
  readonly t: string;
  /** Position in km in the export frame (inertial, relative to the centre). */
  readonly position: readonly [number, number, number];
}

export interface CzmlOptions {
  readonly id: string;
  readonly name: string;
  /** Window start and stop, ISO 8601 UTC. */
  readonly start: string;
  readonly stop: string;
  readonly samples: readonly CzmlSample[];
  /** Reference frame: INERTIAL (default) or FIXED. */
  readonly referenceFrame?: 'INERTIAL' | 'FIXED';
  /** Path colour as [r, g, b, a] 0..255. */
  readonly pathColor?: readonly [number, number, number, number];
}

const KM_TO_M = 1000;

/** Thrown when a CZML export input has a bad time or value. Fail loudly (CLAUDE.md). */
export class CzmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CzmlError';
  }
}

/** Parse an ISO time to epoch ms, failing loudly so a NaN never reaches the output. */
function parseTime(label: string, value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new CzmlError(`exportCzml: ${label} is not a valid time: "${value}"`);
  return ms;
}

/** Produce a CZML document array for the given trajectory samples. */
export function exportCzml(options: CzmlOptions): unknown[] {
  const epochMs = parseTime('start', options.start);
  const cartesian: number[] = [];
  for (const s of options.samples) {
    const dt = (parseTime(`sample time "${s.t}"`, s.t) - epochMs) / 1000;
    cartesian.push(dt, s.position[0] * KM_TO_M, s.position[1] * KM_TO_M, s.position[2] * KM_TO_M);
  }

  const document = {
    id: 'document',
    name: options.name,
    version: '1.0',
    clock: {
      interval: `${options.start}/${options.stop}`,
      currentTime: options.start,
      multiplier: 60,
      range: 'LOOP_STOP',
      step: 'SYSTEM_CLOCK_MULTIPLIER',
    },
  };

  const entity = {
    id: options.id,
    name: options.name,
    availability: `${options.start}/${options.stop}`,
    position: {
      epoch: options.start,
      referenceFrame: options.referenceFrame ?? 'INERTIAL',
      cartesian,
    },
    path: {
      material: {
        solidColor: {
          color: { rgba: [...(options.pathColor ?? [255, 170, 51, 255])] },
        },
      },
      width: 2,
      leadTime: 0,
      trailTime: Number.MAX_SAFE_INTEGER,
      resolution: 120,
    },
  };

  return [document, entity];
}
