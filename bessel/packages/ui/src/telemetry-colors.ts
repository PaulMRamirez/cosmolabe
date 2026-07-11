// Telemetry colors derived from the selene design tokens (ADR-0013: @bessel/ui may
// import @bessel/selene-design, a leaf presentation tier). The Yamcs severity ladder
// drives two mappings, neither of which is ever written into a data-* attribute (the
// raw 6-level severity string stays the attribute value, so the test contract holds):
//
//  1. SEVERITY_HEX: concrete sRGB hex per severity, converted once at module load
//     from the oklch tokenValues. The SVG threshold stroke uses hex (not var() or
//     oklch()) because an SVG presentation attribute does not resolve var(). The
//     strokes are thin graphics, not text, so they are exempt from the text-contrast
//     rule; the DOM tile values, by contrast, use the AA text tokens (--ink-0), not a
//     severity accent, since the accents are tuned for borders/dots, not body text.
//  2. toneFor: the 6-level ladder collapsed onto selene's 4 StatusDot tones for the
//     readout and HUD glyphs (decorative, so not contrast-governed).
//
// selene tokenValues exposes green/amber/red/redHot among status colors, so the six
// severities are sourced honestly: watch and warning share amber, distress and
// critical share red, severe escalates to redHot. The perceptual distinctness lives
// in the StatusDot tone band plus the redHot escalation; data-severity keeps full
// 6-level fidelity.

import { oklchToRgb, rgbToHexString } from '@bessel/color';
import { tokenValues } from '@bessel/selene-design/tokens';
import type { StatusTone } from '@bessel/selene-design';
import type { TelemetrySeverity } from './TelemetryOverlay.tsx';

const hx = (k: keyof typeof tokenValues): string => rgbToHexString(oklchToRgb(tokenValues[k]));

/** Threshold-line stroke per severity (concrete sRGB hex; SVG attributes need it). */
export const SEVERITY_HEX: Record<TelemetrySeverity, string> = {
  nominal: hx('green'),
  watch: hx('amber'),
  warning: hx('amber'),
  distress: hx('red'),
  critical: hx('red'),
  severe: hx('redHot'),
};

/** Structural strokes for the chart lines, token-derived (not severity-coded). */
export const STROKE = {
  /** Predicted reference line: a desaturated grey. */
  predicted: hx('ink2'),
  /** Actual/residual line: the data accent (cyan). */
  actual: hx('cyan'),
  /** The moving now-line: near-white. */
  now: hx('ink0'),
} as const;

/** Collapse the 6-level Yamcs ladder onto selene's StatusDot tone band. */
export function toneFor(severity: TelemetrySeverity): StatusTone {
  switch (severity) {
    case 'nominal':
      return 'nominal';
    case 'watch':
    case 'warning':
      return 'caution';
    case 'distress':
      return 'fault';
    case 'critical':
    case 'severe':
      return 'critical';
  }
}
