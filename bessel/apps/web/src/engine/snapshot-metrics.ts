// The generalized compare-snapshot metric builders (analysis-UX Wave 2B). Every result block
// across the six domain panels can be "Kept for compare"; this pure module maps a result kind to
// the decision-relevant metrics for that kind (a name -> value map), reading only the store state.
// Keeping it pure and headless makes the generalized snapshot model unit-testable without a DOM,
// and keeps the engine's keepSnapshot a thin dispatch. A builder returns null when its result is
// not present yet (so Keep is a no-op rather than snapshotting an empty result).

import type { AppState, SnapshotDomain } from '../store/index.ts';

/** The decision-relevant metrics for one result kind, keyed by metric name. */
export type SnapshotMetrics = Readonly<Record<string, string | number>>;

/** The kept-snapshot kinds: a domain plus, when a domain owns more than one result block, the
 *  specific result within it (e.g. lighting has beta + eclipse + solar-intensity). */
export type SnapshotKind =
  | 'lighting-beta'
  | 'lighting-eclipse'
  | 'lighting-solar'
  | 'access'
  | 'access-passes'
  | 'access-worksheet'
  | 'access-slew'
  | 'conjunction'
  | 'conjunction-event'
  | 'coverage'
  | 'orbit-porkchop'
  | 'orbit-mcs'
  | 'link';

/** The domain a snapshot kind belongs to (the compare-tray grouping key). */
export function kindDomain(kind: SnapshotKind): SnapshotDomain {
  if (kind === 'conjunction' || kind === 'conjunction-event') return 'conjunction';
  if (kind === 'coverage') return 'coverage';
  if (kind === 'orbit-porkchop' || kind === 'orbit-mcs') return 'orbit';
  if (kind === 'link' || kind === 'access-worksheet') return 'link';
  if (kind.startsWith('lighting')) return 'lighting';
  return 'access';
}

/** A finite number rounded to `d` places, else '-'. */
const n = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '-');

/**
 * The compare label for a snapshot kind. Defaults to "<kind> <seq>", but a coverage
 * snapshot reads "Walker T/P/perPlane" from the designed constellation so the kept
 * column identifies the DESIGN (24/3/8), not an opaque "coverage 1". Other kinds keep
 * the sequenced default; the seq guarantees uniqueness when a design is absent.
 */
export function buildSnapshotLabel(kind: SnapshotKind, s: AppState, seq: number): string {
  if (kind === 'coverage') {
    const d = s.designedConstellation;
    if (d) return `Walker ${d.totalSats}/${d.planes}/${d.perPlane}`;
  }
  return `${kind} ${seq}`;
}

/**
 * Build the decision metrics for a snapshot kind from the current store state, or null when the
 * underlying result is not present (so a Keep is a no-op). Every metric carries its unit in the
 * key so the compare table reads as a decision sheet.
 */
export function buildSnapshotMetrics(kind: SnapshotKind, s: AppState): SnapshotMetrics | null {
  switch (kind) {
    case 'lighting-beta': {
      const b = s.betaSeries;
      if (!b) return null;
      const v = b.series.value;
      let min = Infinity;
      let max = -Infinity;
      for (const x of v) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
      return {
        'beta min (deg)': n(min, 1),
        'beta max (deg)': n(max, 1),
        'eclipse-onset (deg)': n(b.onsetDeg, 1),
      };
    }
    case 'lighting-eclipse': {
      const e = s.eclipsePhases;
      if (!e) return null;
      return {
        'shadowed (min/day)': n(e.shadowSecPerDay / 60, 1),
        'umbra windows': e.umbra.length,
        'penumbra windows': e.penumbra.length,
      };
    }
    case 'lighting-solar': {
      const si = s.solarIntensitySeries;
      if (!si || si.value.length === 0) return null;
      let min = Infinity;
      let sum = 0;
      for (const x of si.value) {
        if (x < min) min = x;
        sum += x;
      }
      return {
        'min visible fraction': n(min, 3),
        'mean visible fraction': n(sum / si.value.length, 3),
      };
    }
    case 'access': {
      const f = s.accessResult?.fom;
      if (!f) return null;
      return {
        'coverage %': n(f.percentCoverage * 100, 1),
        passes: f.accessCount,
        'max gap (min)': n(f.maxGapSec / 60, 1),
      };
    }
    case 'access-passes': {
      const p = s.stationPasses;
      if (!p) return null;
      return {
        passes: p.passes.length,
        'coverage %': n(p.fom.percentCoverage * 100, 1),
        'max gap (min)': n(p.fom.maxGapSec / 60, 1),
      };
    }
    case 'access-worksheet': {
      const w = s.linkWorksheet;
      if (!w) return null;
      return {
        'worst margin (dB)': n(w.worstCase.marginDb, 1),
        'nominal margin (dB)': n(w.nominal.marginDb, 1),
        'required Eb/N0 (dB)': n(w.requiredEbN0Db, 1),
        modcod: w.modcodName,
      };
    }
    case 'access-slew': {
      const v = s.slewFeasibility;
      if (!v) return null;
      return {
        fits: v.fits ? 'yes' : 'no',
        'slew (deg)': n(v.slewAngleDeg, 1),
        'slew (s)': n(v.slewDurationSec, 1),
        'gap (s)': n(v.gapSec, 1),
        'slack (s)': n(v.slackSec, 1),
      };
    }
    case 'conjunction': {
      const c = s.conjunction;
      if (!c) return null;
      return {
        Pc: c.pc.toExponential(2),
        'miss (km)': n(c.missKm),
        'rel speed (km/s)': n(c.relSpeedKmS, 3),
      };
    }
    case 'conjunction-event': {
      const ev = s.conjunctionEvent;
      if (!ev) return null;
      return {
        Pc: ev.pcFull === null ? 'n/a' : ev.pcFull.toExponential(2),
        'max Pc': ev.pcMax.toExponential(2),
        'miss (km)': n(ev.missKm, 3),
        'rel speed (km/s)': n(ev.relSpeedKmS, 3),
      };
    }
    case 'coverage': {
      const g = s.coverageGrid;
      if (!g) return null;
      const m: Record<string, string | number> = {};
      // Lead with the DESIGN inputs so a kept coverage column captures what produced the
      // numbers (the Walker pattern + selected FOM), not only the outcome.
      const d = s.designedConstellation;
      if (d) m.Walker = `${d.totalSats}/${d.planes}/${d.perPlane}`;
      if (g.metric) m.metric = g.metric.label;
      m['area-weighted %'] = n(g.areaWeightedPercentCoverage * 100, 1);
      m.cells = g.cellCount;
      m.assets = g.assetCount;
      if (g.summary) m['worst revisit (min)'] = n(g.summary.worstRevisitMaxSec / 60, 1);
      return m;
    }
    case 'orbit-porkchop': {
      const p = s.porkchop;
      if (!p || !p.best) return null;
      return {
        'min dv (km/s)': n(p.best.deltaVKmS, 4),
        'departure (+d)': n((p.best.departureEt - p.departureEt[0]!) / 86400, 1),
        'TOF (d)': n(p.best.tofSec / 86400, 1),
      };
    }
    case 'orbit-mcs': {
      const r = s.mcsResult;
      if (!r) return null;
      const m: Record<string, string | number> = {
        'final radius (km)': n(r.finalRadiusKm, 1),
        'final speed (km/s)': n(r.finalSpeedKmS, 4),
      };
      if (r.solvedDvKmS !== null) m['solved dv (km/s)'] = n(r.solvedDvKmS, 4);
      if (r.converged !== null) m.converged = r.converged ? 'yes' : 'no';
      return m;
    }
    case 'link': {
      const link = s.linkSeries;
      if (!link || link.value.length === 0) return null;
      let min = Infinity;
      let sum = 0;
      for (const v of link.value) {
        if (v < min) min = v;
        sum += v;
      }
      return {
        'min Eb/N0 (dB)': n(min, 1),
        'mean Eb/N0 (dB)': n(sum / link.value.length, 1),
      };
    }
  }
}
