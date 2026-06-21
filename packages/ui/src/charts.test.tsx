// The analysis charting primitives render their data: a Gantt bar per interval and
// a scaled polyline for a series. (STK_PARITY_SPEC F5.)

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { IntervalTimeline } from './IntervalTimeline.tsx';
import { TimeSeriesChart } from './TimeSeriesChart.tsx';
import { GroundTrackMap } from './GroundTrackMap.tsx';
import { ReportTable, reportToText } from './ReportTable.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('ReportTable precision + reportToText', () => {
  it('formats cells at the requested significant digits (default 6)', () => {
    const cols = ['a'];
    const rows = [[1234.5678]];
    expect(html(createElement(ReportTable, { columns: cols, rows, precision: 3 }))).toContain('1.23e+3');
    // Omitting precision preserves the 6-sig-fig default (guards existing callers).
    expect(html(createElement(ReportTable, { columns: cols, rows }))).toContain('1234.57');
  });

  it('serializes a report to TSV at the requested precision', () => {
    expect(reportToText(['et', 'v'], [[0, 1234.5678]], 3)).toBe('et\tv\n0.00\t1.23e+3\n');
    // Empty rows yield a header-only document.
    expect(reportToText(['et', 'v'], [], 6)).toBe('et\tv\n');
  });
});

describe('IntervalTimeline', () => {
  it('renders one bar per interval and an interval count', () => {
    const out = html(
      createElement(IntervalTimeline, {
        intervals: [
          [10, 20],
          [40, 70],
        ],
        span: [0, 100],
        label: 'Access',
      }),
    );
    expect((out.match(/bessel-gantt-bar/g) ?? []).length).toBe(2);
    expect(out).toContain('2 intervals');
    // The first bar starts at 10% and spans 10% of the 0..100 window.
    expect(out).toContain('left:10%');
    expect(out).toContain('width:10%');
  });

  it('handles an empty window', () => {
    const out = html(createElement(IntervalTimeline, { intervals: [], span: [0, 100] }));
    expect(out).toContain('0 intervals');
    expect(out).not.toContain('bessel-gantt-bar');
  });
});

describe('TimeSeriesChart', () => {
  it('renders a polyline with one point per sample', () => {
    const out = html(
      createElement(TimeSeriesChart, {
        et: [0, 1, 2, 3],
        value: [0, 10, 5, 20],
      }),
    );
    expect(out).toContain('<polyline');
    const pts = out.match(/points="([^"]+)"/)?.[1] ?? '';
    expect(pts.trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders no line for too few points', () => {
    const out = html(createElement(TimeSeriesChart, { et: [0], value: [1] }));
    expect(out).not.toContain('<polyline');
  });
});

describe('GroundTrackMap', () => {
  it('draws a single polyline for a continuous track', () => {
    const out = html(
      createElement(GroundTrackMap, {
        lon: [-0.2, 0, 0.2, 0.4],
        lat: [0.1, 0.2, 0.1, 0],
      }),
    );
    expect((out.match(/bessel-groundtrack-line/g) ?? []).length).toBe(1);
  });

  it('splits the track where it wraps across the antimeridian', () => {
    // A jump from +pi-ish to -pi-ish should break the polyline into two segments.
    const out = html(
      createElement(GroundTrackMap, {
        lon: [3.0, 3.1, -3.1, -3.0],
        lat: [0, 0, 0, 0],
      }),
    );
    expect((out.match(/bessel-groundtrack-line/g) ?? []).length).toBe(2);
  });

  it('renders a single-point segment (trapped between two wraps) as a dot', () => {
    // Each sample wraps relative to its neighbour, so every segment holds exactly one
    // point. These must not be dropped: they render as circles, not polylines.
    const out = html(
      createElement(GroundTrackMap, {
        lon: [3.0, -3.0, 3.0],
        lat: [0, 0, 0],
      }),
    );
    expect((out.match(/bessel-groundtrack-line/g) ?? []).length).toBe(0);
    expect((out.match(/bessel-groundtrack-point/g) ?? []).length).toBe(3);
  });
});

describe('ReportTable', () => {
  it('renders headers and rows with a row count', () => {
    const out = html(
      createElement(ReportTable, {
        columns: ['UTC', 'range (km)'],
        rows: [
          ['2004-001', 1000],
          ['2004-002', 2000],
        ],
      }),
    );
    expect(out).toContain('range (km)');
    expect((out.match(/<tr>/g) ?? []).length).toBe(3); // header + 2 data rows
    expect(out).toContain('2 rows');
  });

  it('truncates a large report to maxRows and notes it', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`t${i}`, i]);
    const out = html(createElement(ReportTable, { columns: ['UTC', 'v'], rows, maxRows: 10 }));
    expect((out.match(/<tr>/g) ?? []).length).toBe(11); // header + 10 shown
    expect(out).toContain('showing first 10');
  });
});
