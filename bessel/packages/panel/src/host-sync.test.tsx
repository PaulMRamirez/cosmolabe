// The host sync contract (PanelController over HostBridge) and the MMGIS
// deep-link parameter contract, pinned where node can see them: bridge
// semantics and controller delegation without a DOM, the deep-link
// round-trip with the triple rule, the civil-to-ET anchor mapping, and the
// cursor marker rendered into the canonical forms' static markup. The live
// bidirectional sync is the MMGIS fixture Playwright spec's evidence.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisProduct, Provenance } from '@bessel/compute';
import {
  controllerFor,
  cursorEtFromStartTime,
  formatMmgisParams,
  HostBridge,
  parseMmgisParams,
  ProductView,
  startTimeFromCursorEt,
  type PanelSelection,
  type PanelSpan,
} from './index.ts';

describe('HostBridge and PanelController', () => {
  it('delegates the full sync surface through the controller', () => {
    const bridge = new HostBridge();
    let disposed = false;
    const controller = controllerFor(bridge, () => (disposed = true));

    const cursors: number[] = [];
    const selections: PanelSelection[] = [];
    const spans: PanelSpan[] = [];
    const offCursor = controller.onCursor((et) => cursors.push(et));
    controller.onSelection((s) => selections.push(s));
    controller.onSpan((s) => spans.push(s));

    // Host to panel: setCursor moves the shared cursor without echoing back.
    controller.setCursor(100);
    expect(bridge.getCursor()).toBe(100);
    expect(cursors).toEqual([]);

    // Panel to host: an in-panel pick moves the cursor AND notifies the host.
    bridge.emitCursor(250);
    expect(bridge.getCursor()).toBe(250);
    expect(cursors).toEqual([250]);

    controller.focusProduct('host-0');
    expect(bridge.getFocused()).toBe('host-0');

    bridge.emitSelection({ key: 'host-0', label: 'traverse', authority: 'host' });
    expect(selections).toEqual([{ key: 'host-0', label: 'traverse', authority: 'host' }]);

    bridge.emitSpan({ et0: 0, et1: 3600 });
    expect(spans).toEqual([{ et0: 0, et1: 3600 }]);
    // A late subscriber still receives the already-known span.
    const late: PanelSpan[] = [];
    controller.onSpan((s) => late.push(s));
    expect(late).toEqual([{ et0: 0, et1: 3600 }]);

    offCursor();
    bridge.emitCursor(300);
    expect(cursors).toEqual([250]);

    controller.dispose();
    expect(disposed).toBe(true);
  });

  it('notifies render subscribers on every state change', () => {
    const bridge = new HostBridge();
    let renders = 0;
    const off = bridge.subscribe(() => renders++);
    bridge.setCursor(1);
    bridge.focusProduct('job-0');
    bridge.emitSpan({ et0: 0, et1: 1 });
    expect(renders).toBe(3);
    off();
    bridge.setCursor(2);
    expect(renders).toBe(3);
  });
});

describe('MMGIS deep-link contract', () => {
  it('round-trips the transcribed parameters', () => {
    const qs = formatMmgisParams({
      mission: 'MSL',
      mapLon: 137.4,
      mapLat: -4.6,
      mapZoom: 10,
      centerPin: 'Bessel handoff',
      startTime: '2004-07-01T02:00:00Z',
      bessel: true,
      besselFocus: 'host-0',
    });
    const back = parseMmgisParams(`?${qs}`);
    expect(back.mission).toBe('MSL');
    expect(back.mapLon).toBe(137.4);
    expect(back.mapLat).toBe(-4.6);
    expect(back.mapZoom).toBe(10);
    expect(back.centerPin).toBe('Bessel handoff');
    expect(back.startTime).toBe('2004-07-01T02:00:00Z');
    expect(back.bessel).toBe(true);
    expect(back.besselFocus).toBe('host-0');
  });

  it('enforces the triple rule in both directions', () => {
    // Formatting: a partial triple is withheld entirely.
    const qs = formatMmgisParams({ mission: 'MSL', mapLon: 137.4, mapZoom: 10 });
    expect(qs).toBe('mission=MSL');
    // Parsing: a partial triple is dropped entirely.
    const parsed = parseMmgisParams('?mapLon=137.4&mapZoom=10');
    expect(parsed.mapLon).toBeUndefined();
    expect(parsed.mapZoom).toBeUndefined();
  });

  it('does not transcribe the heritage selected and on parameters (divergence 3)', () => {
    const parsed = parseMmgisParams('?selected=layer,1,2&on=layer,0.5') as Record<
      string,
      unknown
    >;
    expect(parsed['selected']).toBeUndefined();
    expect(parsed['on']).toBeUndefined();
  });

  it('anchors civil startTime onto the ET axis at the compute epoch', () => {
    const epochIso = '2004-07-01T01:00:00';
    const epochEt = 141868864.185; // whatever the substrate resolved; only the anchor matters
    // One hour after the epoch in civil time is exactly +3600 in ET (no leap
    // second inside the window).
    expect(cursorEtFromStartTime('2004-07-01T02:00:00Z', epochIso, epochEt)).toBeCloseTo(
      epochEt + 3600,
      9,
    );
    // The reverse mapping round-trips.
    expect(startTimeFromCursorEt(epochEt + 3600, epochIso, epochEt)).toBe(
      '2004-07-01T02:00:00.000Z',
    );
    expect(cursorEtFromStartTime('not a time', epochIso, epochEt)).toBeNull();
  });
});

describe('cursor markers in the canonical forms', () => {
  const provenance: Provenance = {
    engine: 'bessel-test',
    version: '0.0.0',
    kernels: { setHash: 'abc', names: [] },
    frame: 'J2000',
    correction: 'NONE',
    authority: 'exploratory',
    computedAt: '2026-07-11T00:00:00Z',
    jobId: 'j',
  };

  it('draws the cursor line on lanes and charts when inside the extent', () => {
    const intervals: AnalysisProduct = {
      product: { kind: 'intervals', sets: [{ label: 'DSS-14', intervals: [[0, 100]] }] },
      provenance,
      units: {},
    };
    const withCursor = renderToStaticMarkup(
      createElement(ProductView, { product: intervals, cursorEt: 50 }),
    );
    expect(withCursor).toContain('data-testid="panel-lane-DSS-14-cursor"');
    expect(withCursor).toContain('data-et="50"');
    const without = renderToStaticMarkup(createElement(ProductView, { product: intervals }));
    expect(without).not.toContain('-cursor');

    const series: AnalysisProduct = {
      product: {
        kind: 'series',
        series: [
          {
            name: 'range',
            unit: 'km',
            et: new Float64Array([0, 100]),
            values: new Float64Array([1, 2]),
          },
        ],
      },
      provenance,
      units: {},
    };
    const chart = renderToStaticMarkup(
      createElement(ProductView, { product: series, cursorEt: 50 }),
    );
    expect(chart).toContain('data-testid="panel-chart-range-cursor"');
    // Outside the extent, the marker is withheld rather than clamped.
    const outside = renderToStaticMarkup(
      createElement(ProductView, { product: series, cursorEt: 500 }),
    );
    expect(outside).not.toContain('-cursor');
  });
});
