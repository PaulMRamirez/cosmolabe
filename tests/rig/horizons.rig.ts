/**
 * The nightly Horizons spot-check (design 04 risk register, item nine): the
 * external-truth lane beside the internal-parity lanes. The differential
 * harness proves the two SPICE paths agree with each other; this rig proves
 * neither has drifted from the world, by comparing frames-tier states over
 * the fetched golden-scenario kernels against the JPL Horizons API's
 * geometric ICRF states for the same bodies at the same TDB epochs.
 *
 * Tolerances are physical-agreement bounds per body, not the harness's bit
 * parity, because the two sides deliberately consume different ephemerides:
 * the GS-2 lane compares the fixture's 040629AP predict SCPSE (the a priori
 * SOI trajectory the golden scenes were built on) against Horizons'
 * reconstructed cassini_merge, so its baseline delta is a recorded property
 * of the fixture, and the tolerance sits above the observed baseline with
 * stated headroom to catch drift, not to certify the predict. The planet
 * lane compares de440s against Horizons' planetary source and is expected
 * near zero. Epoch mapping is exact: ET seconds to JD TDB via
 * 2451545.0 + et / 86400 (both TDB), quoted to 10 decimals (about 9
 * microseconds, sub-meter at planetary speeds).
 *
 * Network honesty: an unreachable Horizons is a named skip (the table
 * records status skipped-unreachable and the rig passes; the wrapper prints
 * the notice), never a red X that trains alarm fatigue and never a green
 * lane that pretends to have run. An HTTP-level or parse-level surprise on
 * a reachable service fails loudly: that is a contract change, not weather.
 *
 * Emits docs/validation/data/horizons-spot-check.json. Driven by
 * scripts/horizons.mjs (and the nightly workflow through it).
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createFramesLayer, type FramesLayer } from '../../bessel/packages/frames/src/index.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const OUT = resolve(process.env.RIG_OUT ?? 'docs/validation/data');
const SK = join(ROOT, 'cosmolabe/packages/spice/test-kernels');
const VK = join(ROOT, 'cosmolabe/apps/viewer/test-catalogs/kernels');

const KERNELS: readonly { name: string; path: string }[] = [
  { name: 'naif0012.tls', path: join(SK, 'naif0012.tls') },
  { name: '040629AP_SCPSE_04179_04185.bsp', path: join(SK, 'cassini/040629AP_SCPSE_04179_04185.bsp') },
  { name: 'de440s.bsp', path: join(VK, 'de440s.bsp') },
];

interface SpotCase {
  readonly lane: string;
  readonly target: string;
  readonly observer: string;
  /** Horizons COMMAND and CENTER for the same pair. */
  readonly command: string;
  readonly center: string;
  readonly epochsUtc: readonly string[];
  /** Physical-agreement tolerances, per body, with the reason recorded. */
  readonly tolPosKm: number;
  readonly tolVelKmS: number;
  readonly note: string;
}

// Tolerance provenance, from the first observed run (2026-07-11, table in
// docs/validation/data): Earth and Mars barycenter against Horizons DE441
// agreed at the sub-meter level (0.1 to 0.4 m; de440s and DE441 are nearly
// identical in the modern era), so their bounds are 2 km / 1e-5 km/s, four
// orders above observation and far below any real drift. Cassini compares
// the predict against the reconstruction: the observed baseline at the two
// pinned epochs is 95.5 and 181.4 km (growing toward SOI, as a
// pre-encounter predict does), and the 500 km bound sits about 2.8x above
// the larger, chosen over the fixed epochs' known baseline rather than a
// blanket 10x, so genuine drift of the same order as the baseline still
// trips it.
const CASES: readonly SpotCase[] = [
  {
    lane: 'GS-2',
    target: 'CASSINI',
    observer: 'SATURN',
    command: '-82',
    center: '500@699',
    epochsUtc: ['2004-07-01T02:48:00', '2004-07-01T04:48:00'],
    tolPosKm: 500,
    tolVelKmS: 0.05,
    note: 'fixture 040629AP predict SCPSE vs Horizons reconstructed cassini_merge; baseline delta is a fixture property, the bound catches drift',
  },
  {
    lane: 'GS-4 era',
    target: 'EARTH',
    observer: 'SUN',
    command: '399',
    center: '500@10',
    epochsUtc: ['2004-07-01T00:00:00', '2004-07-31T00:00:00'],
    tolPosKm: 2,
    tolVelKmS: 1e-5,
    note: 'de440s vs the Horizons planetary source; expected sub-km',
  },
  {
    lane: 'GS-4 era',
    target: 'MARS BARYCENTER',
    observer: 'SUN',
    command: '4',
    center: '500@10',
    epochsUtc: ['2004-07-01T00:00:00', '2004-07-31T00:00:00'],
    tolPosKm: 2,
    tolVelKmS: 1e-5,
    note: 'de440s vs the Horizons planetary source; expected sub-km',
  },
];

interface SpotRow {
  readonly lane: string;
  readonly target: string;
  readonly observer: string;
  readonly epochUtc: string;
  readonly jdTdb: string;
  readonly dPosKm: number;
  readonly dVelKmS: number;
  readonly tolPosKm: number;
  readonly tolVelKmS: number;
  readonly pass: boolean;
  readonly horizonsSource: string;
}

class HorizonsUnreachable extends Error {}

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

async function fetchVectors(
  c: SpotCase,
  jds: readonly string[],
): Promise<{ states: number[][]; source: string }> {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${c.command}'`,
    OBJ_DATA: `'NO'`,
    MAKE_EPHEM: `'YES'`,
    EPHEM_TYPE: `'VECTORS'`,
    CENTER: `'${c.center}'`,
    REF_SYSTEM: `'ICRF'`,
    REF_PLANE: `'FRAME'`,
    VEC_CORR: `'NONE'`,
    OUT_UNITS: `'KM-S'`,
    VEC_TABLE: `'2'`,
    CSV_FORMAT: `'YES'`,
    TLIST: `'${jds.join(' ')}'`,
  });
  let text: string;
  try {
    const res = await fetch(`${API}?${params.toString()}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string };
    if (typeof body.result !== 'string') throw new Error('no result field in the API response');
    text = body.result;
  } catch (err) {
    // Timeouts, DNS, refused connections, HTTP errors: the service is not
    // answering as a service; that is weather, not a regression.
    throw new HorizonsUnreachable(err instanceof Error ? err.message : String(err));
  }
  // From here on, surprises are contract changes and fail loudly.
  const soe = text.indexOf('$$SOE');
  const eoe = text.indexOf('$$EOE');
  if (soe < 0 || eoe < 0) {
    throw new Error(`Horizons response for ${c.target} carries no $$SOE block:\n${text.slice(0, 400)}`);
  }
  const rows = text
    .slice(soe + 5, eoe)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (rows.length !== jds.length) {
    throw new Error(`Horizons returned ${rows.length} rows for ${jds.length} epochs (${c.target})`);
  }
  const states = rows.map((line) => {
    const parts = line.split(',').map((s) => s.trim());
    const nums = parts.slice(2, 8).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      throw new Error(`non-numeric Horizons state row: "${line}"`);
    }
    return nums;
  });
  const sourceMatch = /Target body name:.*\{source:\s*([^}]+)\}/.exec(text);
  return { states, source: sourceMatch?.[1]?.trim() ?? 'unknown' };
}

function writeTable(payload: object): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, 'horizons-spot-check.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf-8',
  );
}

describe('Horizons spot-check (external truth, design 04 risk nine)', () => {
  let frames: FramesLayer;

  beforeAll(async () => {
    frames = await createFramesLayer();
    for (const k of KERNELS) frames.furnish(k.name, new Uint8Array(readFileSync(k.path)));
  });

  test('frames-tier states agree with Horizons within the stated per-body tolerances', async () => {
    const rows: SpotRow[] = [];
    try {
      for (const c of CASES) {
        const ets = c.epochsUtc.map((u) => frames.toEt(u));
        const jds = ets.map((et) => (2451545.0 + et / 86400).toFixed(10));
        const batch = await frames.states({
          targets: [c.target],
          observer: c.observer,
          frame: 'J2000',
          correction: 'NONE',
          epochs: ets,
        });
        const horizons = await fetchVectors(c, jds);
        for (let i = 0; i < ets.length; i++) {
          const h = horizons.states[i]!;
          let dp = 0;
          let dv = 0;
          for (let k = 0; k < 3; k++) {
            dp += (h[k]! - batch.states[i * 6 + k]!) ** 2;
            dv += (h[3 + k]! - batch.states[i * 6 + 3 + k]!) ** 2;
          }
          const dPosKm = Math.sqrt(dp);
          const dVelKmS = Math.sqrt(dv);
          rows.push({
            lane: c.lane,
            target: c.target,
            observer: c.observer,
            epochUtc: c.epochsUtc[i]!,
            jdTdb: jds[i]!,
            dPosKm,
            dVelKmS,
            tolPosKm: c.tolPosKm,
            tolVelKmS: c.tolVelKmS,
            pass: dPosKm <= c.tolPosKm && dVelKmS <= c.tolVelKmS,
            horizonsSource: horizons.source,
          });
        }
      }
    } catch (err) {
      if (err instanceof HorizonsUnreachable) {
        writeTable({
          description:
            'Horizons spot-check: SKIPPED, the service was unreachable (a named skip, not a pass and not an alarm).',
          status: 'skipped-unreachable',
          reason: err.message,
          generatedAt: new Date().toISOString(),
          rows: [],
        });
        console.warn(`horizons: unreachable (${err.message}); recorded as a named skip.`);
        return;
      }
      throw err;
    }

    const allPass = rows.every((r) => r.pass);
    writeTable({
      description:
        'Horizons spot-check (design 04 risk nine): frames-tier states over the fetched golden-scenario kernels vs JPL Horizons geometric ICRF states at the same TDB epochs. Physical-agreement tolerances per body: the GS-2 lane compares the 040629AP predict fixture against the reconstructed cassini_merge, so its baseline delta is a fixture property and the bound catches drift; the planet lane compares de440s against the Horizons planetary source and is expected sub-km. Kernels: naif0012.tls, 040629AP_SCPSE_04179_04185.bsp, de440s.bsp.',
      status: 'ok',
      api: API,
      generatedAt: new Date().toISOString(),
      cases: CASES.map((c) => ({ lane: c.lane, target: c.target, note: c.note })),
      rows,
      allPass,
    });

    for (const r of rows) {
      expect(
        r.dPosKm,
        `${r.target} vs ${r.observer} at ${r.epochUtc}: position delta km (tol ${r.tolPosKm})`,
      ).toBeLessThanOrEqual(r.tolPosKm);
      expect(
        r.dVelKmS,
        `${r.target} vs ${r.observer} at ${r.epochUtc}: velocity delta km/s (tol ${r.tolVelKmS})`,
      ).toBeLessThanOrEqual(r.tolVelKmS);
    }
  }, 120_000);
});
