import { describe, it, expect } from 'vitest';
import { screenAllVsAll } from '@bessel/conjunction';
import { ingestCatalog, IngestError } from './ingest.ts';
import { SAMPLE_CDM, SAMPLE_OEM, SAMPLE_TLE_SET } from '../panels/conjunction/sample-ingest.ts';

// The ingestion is a pure parse->catalog function (REAL parsers), so it is unit-tested directly
// against the small CDM/OEM/TLE fixtures: each ingests to a shared-grid catalog screenAllVsAll
// accepts, the CDM carries per-object covariances, and malformed input fails loud.

describe('ingestCatalog (REAL CDM/OEM/TLE -> screening catalog)', () => {
  it('ingests a CDM with two state vectors and per-object covariances', () => {
    const result = ingestCatalog('cdm', SAMPLE_CDM);
    expect(result.format).toBe('cdm');
    expect(result.catalog).toHaveLength(2);
    expect(result.catalog.map((o) => o.id).sort()).toEqual(['PRIMARY-A', 'SECONDARY-B']);
    // Both objects carry a full covariance.
    expect(result.covariances.size).toBe(2);
    const cov = result.covariances.get('PRIMARY-A');
    expect(cov).toBeDefined();
    expect(cov!.posCov3).toHaveLength(9);
    expect(cov!.state6).toHaveLength(6);
    // The position-covariance diagonal is positive (a real covariance after RTN->inertial rotation).
    expect(cov!.posCov3[0]!).toBeGreaterThan(0);
    expect(cov!.posCov3[4]!).toBeGreaterThan(0);
    expect(cov!.posCov3[8]!).toBeGreaterThan(0);
  });

  it('produces a shared-grid CDM catalog screenAllVsAll accepts and flags the close pair', () => {
    const result = ingestCatalog('cdm', SAMPLE_CDM);
    const events = screenAllVsAll(result.catalog, { thresholdKm: 5 });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0]!;
    expect(ev.missKm).toBeLessThanOrEqual(5);
  });

  it('ingests a two-segment OEM into a shared-grid catalog (no covariance)', () => {
    const result = ingestCatalog('oem', SAMPLE_OEM);
    expect(result.format).toBe('oem');
    expect(result.catalog).toHaveLength(2);
    expect(result.covariances.size).toBe(0);
    // The two objects share the screening grid (same length, same epochs).
    const [a, b] = result.catalog;
    expect(a!.et.length).toBe(b!.et.length);
    expect(a!.et[0]).toBe(b!.et[0]);
    const events = screenAllVsAll(result.catalog, { thresholdKm: 10 });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('ingests a TLE set into a shared-grid catalog (no covariance)', () => {
    const result = ingestCatalog('tle', SAMPLE_TLE_SET);
    expect(result.format).toBe('tle');
    expect(result.catalog).toHaveLength(2);
    expect(result.covariances.size).toBe(0);
    // Each object has the full sampled ephemeris shape.
    for (const o of result.catalog) {
      expect(o.pos.length).toBe(o.et.length * 3);
      expect(o.vel.length).toBe(o.et.length * 3);
    }
  });

  it('fails loud on malformed input', () => {
    expect(() => ingestCatalog('cdm', 'NOT A CDM')).toThrow();
    expect(() => ingestCatalog('oem', 'NOT AN OEM')).toThrow();
    expect(() => ingestCatalog('tle', 'just one line')).toThrow(IngestError);
    expect(() => ingestCatalog('cdm', '')).toThrow(IngestError);
  });

  it('rejects a TLE set with fewer than two objects', () => {
    const oneObject = SAMPLE_TLE_SET.split('\n').slice(0, 3).join('\n');
    expect(() => ingestCatalog('tle', oneObject)).toThrow(/at least 2/);
  });
});
