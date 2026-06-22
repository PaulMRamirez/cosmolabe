import { describe, expect, it, vi } from 'vitest';
import { seriesToCsv, intervalsToCsv, tableToCsv, writeOem, type Oem } from '@bessel/interop';
import { exportAnalysis, ExportAnalysisError, type ExportSpec } from './export-analysis.ts';

// The unified export service routes each result kind to the matching @bessel/interop
// builder, triggers a download, and returns the serialized text. We assert routing by
// comparing the returned text to a direct builder call and by capturing the download.

describe('exportAnalysis routing', () => {
  it('routes a series spec to seriesToCsv and downloads it', () => {
    const download = vi.fn();
    const spec: ExportSpec = {
      kind: 'series',
      et: [0, 60, 120],
      columns: [[1, 2, 3]],
      names: ['range_km'],
      filename: 'range.csv',
    };
    const text = exportAnalysis(spec, download);
    expect(text).toBe(seriesToCsv(spec.et, spec.columns, spec.names, {}));
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0]?.[1]).toBe('range.csv');
    expect(download.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  it('routes a series spec with meta through to the CSV preamble', () => {
    const spec: ExportSpec = {
      kind: 'series',
      et: [0, 1],
      columns: [[10, 11]],
      names: ['v'],
      filename: 'v.csv',
      meta: { frame: 'J2000', span: '1 d' },
    };
    const text = exportAnalysis(spec, () => undefined);
    expect(text).toBe(seriesToCsv(spec.et, spec.columns, spec.names, { meta: spec.meta }));
    expect(text).toContain('# frame: J2000');
  });

  it('routes an intervals spec to intervalsToCsv', () => {
    const spec: ExportSpec = {
      kind: 'intervals',
      intervals: [
        [0, 100],
        [200, 350],
      ],
      filename: 'access.csv',
    };
    const text = exportAnalysis(spec, () => undefined);
    expect(text).toBe(intervalsToCsv(spec.intervals, {}));
  });

  it('routes a table spec to tableToCsv', () => {
    const spec: ExportSpec = {
      kind: 'table',
      headers: ['quantity', 'value'],
      rows: [
        ['miss_km', 1.23],
        ['pc', 0.0004],
      ],
      filename: 'conjunction.csv',
    };
    const text = exportAnalysis(spec, () => undefined);
    expect(text).toBe(tableToCsv(spec.headers, spec.rows, {}));
  });

  it('routes an oem spec to writeOem', () => {
    const oem: Oem = {
      version: '2.0',
      metadata: { objectName: 'SC', centerName: 'EARTH', refFrame: 'J2000', timeSystem: 'UTC' },
      states: [{ epoch: '2026-01-01T00:00:00', position: [1, 2, 3], velocity: [4, 5, 6] }],
    };
    const spec: ExportSpec = { kind: 'oem', oem, filename: 'sc.oem' };
    const text = exportAnalysis(spec, () => undefined);
    expect(text).toBe(writeOem(oem));
  });

  it('fails loudly with a typed, located error on an unknown kind', () => {
    // Force an off-union value past the type checker to exercise the runtime guard.
    const bad = { kind: 'bogus', filename: 'x.csv' } as unknown as ExportSpec;
    expect(() => exportAnalysis(bad, () => undefined)).toThrow(ExportAnalysisError);
    expect(() => exportAnalysis(bad, () => undefined)).toThrow(/exportAnalysis\(bogus\)/);
  });
});
