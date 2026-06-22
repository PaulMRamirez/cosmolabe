import { describe, it, expect } from 'vitest';
import { screenAllVsAll } from '@bessel/conjunction';
import { buildSyntheticCatalog, SYNTHETIC_SCREEN_DEFAULTS } from './synthetic-catalog.ts';

const OPTS = { epochEt: 1000, spanSec: SYNTHETIC_SCREEN_DEFAULTS.spanSec, steps: 200 };

describe('buildSyntheticCatalog', () => {
  it('is deterministic: identical inputs yield byte-identical samples', () => {
    const a = buildSyntheticCatalog(OPTS);
    const b = buildSyntheticCatalog(OPTS);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.id).toBe(b[i]!.id);
      expect(Array.from(a[i]!.pos)).toEqual(Array.from(b[i]!.pos));
      expect(Array.from(a[i]!.vel)).toEqual(Array.from(b[i]!.vel));
      expect(Array.from(a[i]!.et)).toEqual(Array.from(b[i]!.et));
    }
  });

  it('puts every object on one strictly-ascending shared epoch grid', () => {
    const objs = buildSyntheticCatalog(OPTS);
    const ref = objs[0]!.et;
    for (const o of objs) {
      expect(Array.from(o.et)).toEqual(Array.from(ref));
      expect(o.pos.length).toBe(o.et.length * 3);
      expect(o.vel.length).toBe(o.et.length * 3);
    }
    for (let k = 1; k < ref.length; k++) expect(ref[k]!).toBeGreaterThan(ref[k - 1]!);
  });

  it('contains at least one flaggable conjunction (the CHASER/TARGET pair)', () => {
    const objs = buildSyntheticCatalog(OPTS);
    const events = screenAllVsAll(objs, { thresholdKm: SYNTHETIC_SCREEN_DEFAULTS.thresholdKm });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ids = events.flatMap((e) => [e.primaryId, e.secondaryId]);
    expect(ids).toContain('CHASER');
    expect(ids).toContain('TARGET');
  });

  it('clamps steps to a minimum of two samples', () => {
    const objs = buildSyntheticCatalog({ epochEt: 0, spanSec: 100, steps: 1 });
    expect(objs[0]!.et.length).toBe(2);
  });
});
