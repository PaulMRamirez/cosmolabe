// On-screen predicted-versus-actual telemetry overlay, following OpenMCT/Yamcs
// idioms: two series on one shared time axis (predicted as the zero reference,
// actual tracking the measured offset), a derived residual line, a vertical
// "now" line tied to the live clock (OpenMCT's Marcus Bains realtime indicator),
// and a horizontal residual-threshold line that recolors by the Yamcs severity
// ladder (watch, warning, distress, critical, severe). A loud fault banner shows
// when the transport adapter reports an error. No charting library: scaled SVG.
// Colors are derived from the selene design tokens (see telemetry-colors.ts,
// ADR-0013), and a selene StatusDot + TeleCell/Gauge/Metric strip provides the
// readout chrome so the overlay matches the rest of the reskinned app.

import { StatusDot, TeleCell, Gauge, Metric } from '@bessel/selene-design';
import type { PredictedVsActual } from '@bessel/state';
import { FaultBanner } from './FaultBanner.tsx';
import { SEVERITY_HEX, STROKE, toneFor } from './telemetry-colors.ts';

/** Yamcs XTCE alarm severities, ascending. The threshold line takes the highest tripped. */
export type TelemetrySeverity = 'nominal' | 'watch' | 'warning' | 'distress' | 'critical' | 'severe';

/** Ascending residual (km) limits mapped to the Yamcs severity ladder. */
export interface SeverityLadder {
  readonly watch: number;
  readonly warning: number;
  readonly distress: number;
  readonly critical: number;
  readonly severe: number;
}

export const DEFAULT_LADDER: SeverityLadder = {
  watch: 1,
  warning: 2,
  distress: 3,
  critical: 4,
  severe: 5,
};

/** The highest severity tripped by a residual against the ladder. */
export function severityFor(residualKm: number, ladder: SeverityLadder): TelemetrySeverity {
  if (residualKm >= ladder.severe) return 'severe';
  if (residualKm >= ladder.critical) return 'critical';
  if (residualKm >= ladder.distress) return 'distress';
  if (residualKm >= ladder.warning) return 'warning';
  if (residualKm >= ladder.watch) return 'watch';
  return 'nominal';
}

export interface TelemetryOverlayProps {
  /** The full predicted-versus-actual series (engine pushes adapter.overlay()). */
  readonly series: readonly PredictedVsActual[];
  /** Live clock epoch (ET seconds) for the moving now-line. */
  readonly nowEt: number;
  /** Residual alarm threshold (km) shown as the reference line. */
  readonly thresholdKm?: number;
  /** Severity ladder for the threshold colour; defaults to DEFAULT_LADDER. */
  readonly ladder?: SeverityLadder;
  /** Loud transport fault from the adapter, shown as a banner when present. */
  readonly fault?: string | null;
  readonly width?: number;
  readonly height?: number;
}

const PAD = 4;

function x(et: number, t0: number, t1: number, w: number): number {
  const dt = t1 - t0 || 1;
  return PAD + ((et - t0) / dt) * (w - 2 * PAD);
}

function y(v: number, vMax: number, h: number): number {
  const dv = vMax || 1;
  return h - PAD - (v / dv) * (h - 2 * PAD);
}

export function TelemetryOverlay(props: TelemetryOverlayProps): JSX.Element {
  const w = props.width ?? 280;
  const h = props.height ?? 120;
  const ladder = props.ladder ?? DEFAULT_LADDER;
  const threshold = props.thresholdKm ?? ladder.warning;
  const n = props.series.length;

  const t0 = n > 0 ? props.series[0]!.et : 0;
  const t1 = n > 0 ? props.series[n - 1]!.et : 1;
  let vMax = threshold;
  for (const s of props.series) if (s.residualKm > vMax) vMax = s.residualKm;
  vMax *= 1.1;

  const latest = n > 0 ? props.series[n - 1]!.residualKm : 0;
  const severity = severityFor(latest, ladder);

  // Two series sharing the time axis: predicted is the zero reference; actual
  // tracks the measured residual. Their separation is the residual line.
  const predictedPts: string[] = [];
  const actualPts: string[] = [];
  for (const s of props.series) {
    const px = x(s.et, t0, t1, w).toFixed(2);
    predictedPts.push(`${px},${y(0, vMax, h).toFixed(2)}`);
    actualPts.push(`${px},${y(s.residualKm, vMax, h).toFixed(2)}`);
  }

  // The live clock can run ahead of the last sample (or before the first); clamp the
  // now-line into the plot box so it pins to the edge instead of drawing off-chart.
  const nowX = Math.max(PAD, Math.min(w - PAD, x(props.nowEt, t0, t1, w))).toFixed(2);
  const thresholdY = y(threshold, vMax, h).toFixed(2);

  return (
    <section
      className="bessel-telemetry-overlay"
      aria-label="Predicted versus actual telemetry"
      data-testid="telemetry-overlay"
      data-severity={severity}
    >
      <FaultBanner fault={props.fault ?? null} />
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Residual ${latest.toFixed(2)} km, severity ${severity}`}
      >
        {n >= 2 ? (
          <>
            <polyline
              className="bessel-telemetry-predicted"
              fill="none"
              stroke={STROKE.predicted}
              strokeDasharray="3 2"
              points={predictedPts.join(' ')}
              data-testid="telemetry-predicted-line"
            />
            <polyline
              className="bessel-telemetry-actual"
              fill="none"
              stroke={STROKE.actual}
              points={actualPts.join(' ')}
              data-testid="telemetry-residual-line"
            />
          </>
        ) : null}
        <line
          className="bessel-telemetry-threshold"
          x1={PAD}
          x2={w - PAD}
          y1={thresholdY}
          y2={thresholdY}
          stroke={SEVERITY_HEX[severity]}
          strokeWidth={1.5}
          data-testid="telemetry-threshold-line"
          data-severity={severity}
        />
        <line
          className="bessel-telemetry-now"
          x1={nowX}
          x2={nowX}
          y1={PAD}
          y2={h - PAD}
          stroke={STROKE.now}
          strokeWidth={1}
          data-testid="telemetry-now-line"
        />
      </svg>
      {/* Additive selene readout chrome. Carries no test contract: the asserted
          severity text stays the sole text content of the readout paragraph, and
          the StatusDot glyph is decorative (aria-hidden, childless). Tile values use
          the AA text tokens, not a severity accent (accents fail text contrast on the
          light theme surface); severity reads from the dot, threshold line, and word. */}
      <p className="bessel-telemetry-readout" data-testid="telemetry-severity" data-severity={severity}>
        <span aria-hidden="true" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
          <StatusDot tone={toneFor(severity)} halo={severity === 'critical' || severity === 'severe'} />
        </span>
        Residual {latest.toFixed(2)} km ({severity})
      </p>
      <div
        className="bessel-telemetry-tiles"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}
      >
        <TeleCell label="RESIDUAL" value={latest.toFixed(2)} unit="km" />
        <TeleCell label="THRESHOLD" value={threshold.toFixed(2)} unit="km" />
        <Gauge label="MARGIN" value={latest / (threshold * 2 || 1)} color="var(--ink-0)" />
        <Metric label="SEVERITY" value={severity} />
      </div>
    </section>
  );
}
