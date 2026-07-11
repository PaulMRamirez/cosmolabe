import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import type { PredictedVsActual } from '@bessel/state';
import { TelemetryOverlay, severityFor, DEFAULT_LADDER } from './TelemetryOverlay.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

function series(residuals: readonly number[], t0 = 100): PredictedVsActual[] {
  return residuals.map((r, i) => ({
    et: t0 + i,
    predicted: [0, 0, 0],
    actual: [r, 0, 0],
    residualKm: r,
  }));
}

describe('@bessel/ui severityFor', () => {
  it('walks the Yamcs severity ladder', () => {
    expect(severityFor(0.5, DEFAULT_LADDER)).toBe('nominal');
    expect(severityFor(1, DEFAULT_LADDER)).toBe('watch');
    expect(severityFor(2, DEFAULT_LADDER)).toBe('warning');
    expect(severityFor(3, DEFAULT_LADDER)).toBe('distress');
    expect(severityFor(4, DEFAULT_LADDER)).toBe('critical');
    expect(severityFor(9, DEFAULT_LADDER)).toBe('severe');
  });
});

describe('@bessel/ui TelemetryOverlay', () => {
  it('renders two series plus a residual and threshold line', () => {
    const out = html(
      createElement(TelemetryOverlay, { series: series([0.2, 0.4, 0.6]), nowEt: 101 }),
    );
    expect(out).toContain('data-testid="telemetry-overlay"');
    expect(out).toContain('data-testid="telemetry-predicted-line"');
    expect(out).toContain('data-testid="telemetry-residual-line"');
    expect(out).toContain('data-testid="telemetry-threshold-line"');
    expect(out).toContain('data-testid="telemetry-now-line"');
  });

  it('colours the threshold by the tripped severity', () => {
    // A residual past the critical limit flips the severity class to critical.
    const nominal = html(createElement(TelemetryOverlay, { series: series([0.2]), nowEt: 100 }));
    expect(nominal).toContain('data-severity="nominal"');
    const tripped = html(
      createElement(TelemetryOverlay, { series: series([4.5]), nowEt: 100 }),
    );
    expect(tripped).toContain('data-severity="critical"');
  });

  it('moves the now-line as the clock epoch advances within the span', () => {
    // The now-line is a vertical line whose x1==x2 equals the clock fraction of the
    // span. Extract it from the markup and assert it advances with the epoch.
    const nowX = (s: string): number => {
      const seg = s.slice(s.indexOf('class="bessel-telemetry-now"'));
      const m = seg.match(/x1="([\d.]+)"/);
      return m ? Number(m[1]) : NaN;
    };
    const start = html(createElement(TelemetryOverlay, { series: series([1, 2, 3]), nowEt: 100 }));
    const mid = html(createElement(TelemetryOverlay, { series: series([1, 2, 3]), nowEt: 102 }));
    expect(nowX(mid)).toBeGreaterThan(nowX(start));
  });

  it('clamps the now-line into the plot box when the clock runs past the samples', () => {
    const nowX = (s: string): number => {
      const seg = s.slice(s.indexOf('class="bessel-telemetry-now"'));
      const m = seg.match(/x1="([\d.]+)"/);
      return m ? Number(m[1]) : NaN;
    };
    const w = 280;
    const pad = 4;
    // Samples span et 100..102; a clock far past the last sample would extrapolate
    // off the right edge without the clamp. It must pin to w - PAD instead.
    const ahead = html(createElement(TelemetryOverlay, { series: series([1, 2, 3]), nowEt: 500, width: w }));
    expect(nowX(ahead)).toBeCloseTo(w - pad, 5);
    // A clock before the first sample pins to the left edge (PAD).
    const behind = html(createElement(TelemetryOverlay, { series: series([1, 2, 3]), nowEt: 0, width: w }));
    expect(nowX(behind)).toBeCloseTo(pad, 5);
  });

  it('shows a fault banner when the adapter reports an error', () => {
    const out = html(
      createElement(TelemetryOverlay, {
        series: series([1]),
        nowEt: 100,
        fault: 'Telemetry frame is not JSON',
      }),
    );
    expect(out).toContain('data-testid="telemetry-fault-banner"');
    expect(out).toContain('Telemetry frame is not JSON');
  });
});
