// Sample a Sampled trajectory: read a state file through the PAL FileSystem (never a
// raw fetch, so the PWA/native paths stay intact), parse the rows (a simple `xyz`
// table or a CCSDS OEM), resolve each epoch to ET, and linearly interpolate onto the
// requested grid (the same positionAt-style interpolation the in-app ephemeris table
// uses). Fails loudly on a missing file, an unparseable row, or too few samples.

import type { SpiceEngine } from '@bessel/spice';
import type { FileSystem } from '@bessel/pal';
import type { Km3 } from '@bessel/scene';
import { TrajectoryError, fillTable, type PositionTable } from './shared.ts';

/** A parsed state row: an epoch string plus a J2000 position (km). */
interface StateRow {
  readonly epoch: string;
  readonly position: Km3;
}

/**
 * Sample a state file onto the ET grid. `format` selects the parser (`xyz`, the
 * default, or `oem`). The file is read through the PAL; epochs are resolved to ET via
 * SPICE; positions are linearly interpolated (and clamped at the ends). Throws a
 * located TrajectoryError on any failure.
 */
export async function sampleSampled(
  spice: SpiceEngine,
  fs: FileSystem,
  source: string,
  format: 'xyz' | 'oem' | undefined,
  etGrid: Float64Array,
): Promise<PositionTable> {
  let text: string;
  try {
    const bytes = await fs.readFile(source);
    text = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new TrajectoryError('Sampled', `cannot read source "${source}"`, err);
  }

  const rows = format === 'oem' ? parseOemRows(text) : parseXyzRows(text);
  if (rows.length < 1) {
    throw new TrajectoryError('Sampled', `source "${source}" has no usable state rows`);
  }

  // Resolve every row epoch to ET once, then interpolate the grid against that table.
  const et = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    try {
      et[i] = await spice.str2et(rows[i]!.epoch.replace(/Z$/, ''));
    } catch (err) {
      throw new TrajectoryError('Sampled', `cannot parse epoch "${rows[i]!.epoch}"`, err);
    }
  }
  // The interpolator assumes ascending epochs; reject an out-of-order file loudly.
  for (let i = 1; i < et.length; i++) {
    if (et[i]! < et[i - 1]!) {
      throw new TrajectoryError('Sampled', `epochs in "${source}" are not in ascending order`);
    }
  }

  return fillTable(etGrid, (k) => interpolate(et, rows, etGrid[k]!));
}

/** Linear interpolation of the position table at et, clamped to the row range. */
function interpolate(et: Float64Array, rows: readonly StateRow[], at: number): Km3 {
  const n = rows.length;
  if (n === 1 || at <= et[0]!) return rows[0]!.position;
  if (at >= et[n - 1]!) return rows[n - 1]!.position;
  // Find the bracketing interval [i, i+1] (linear scan; grids here are small).
  let i = 0;
  while (i < n - 2 && et[i + 1]! < at) i++;
  const t0 = et[i]!;
  const t1 = et[i + 1]!;
  const f = t1 === t0 ? 0 : (at - t0) / (t1 - t0);
  const a = rows[i]!.position;
  const b = rows[i + 1]!.position;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Parse an `xyz` table: each non-comment line is `epoch x y z`. */
function parseXyzRows(text: string): StateRow[] {
  const rows: StateRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\s,]+/);
    if (parts.length < 4) {
      throw new TrajectoryError('Sampled', `xyz row needs "epoch x y z", got "${line}"`);
    }
    const nums = parts.slice(1, 4).map((s) => Number(s));
    if (!nums.every(Number.isFinite)) {
      throw new TrajectoryError('Sampled', `xyz row has a non-numeric coordinate: "${line}"`);
    }
    rows.push({ epoch: parts[0]!, position: [nums[0]!, nums[1]!, nums[2]!] });
  }
  return rows;
}

/** Parse the ephemeris data lines of a CCSDS OEM, keeping epoch + position only. */
function parseOemRows(text: string): StateRow[] {
  const rows: StateRow[] = [];
  let inMeta = false;
  let sawVersion = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('COMMENT')) continue;
    if (line.startsWith('CCSDS_OEM_VERS')) {
      sawVersion = true;
      continue;
    }
    if (line === 'META_START') {
      inMeta = true;
      continue;
    }
    if (line === 'META_STOP') {
      inMeta = false;
      continue;
    }
    if (line.includes('=')) continue; // metadata or header line
    if (inMeta) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      throw new TrajectoryError('Sampled', `OEM data line has too few fields: "${line}"`);
    }
    const nums = parts.slice(1, 4).map((s) => Number(s));
    if (!nums.every(Number.isFinite)) {
      throw new TrajectoryError('Sampled', `OEM data line has a non-numeric field: "${line}"`);
    }
    rows.push({ epoch: parts[0]!, position: [nums[0]!, nums[1]!, nums[2]!] });
  }
  if (!sawVersion) {
    throw new TrajectoryError('Sampled', 'not a CCSDS OEM (missing CCSDS_OEM_VERS)');
  }
  return rows;
}
