// oklch -> sRGB conversion. The design tokens (@bessel/selene-design) are authored
// in the oklch color space, but THREE.Color and CSS-string scene inputs cannot parse
// oklch, so a programmatic consumer that wants a token's actual color for WebGL or a
// hex string converts it here. Pure math, no token or design-system dependency, so it
// stays in core: the app composes a token value with this converter.

import type { Rgb } from './index.ts';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Linear-light component to gamma-encoded sRGB (the standard transfer function). */
function linearToSrgb(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return clamp01(v);
}

/**
 * Parse an `oklch(L C H)` string (L in 0..1, C chroma, H degrees, optional `/ alpha`
 * which is ignored) into gamma-encoded sRGB components in 0..1. Throws on a string
 * that is not oklch so a bad token fails loudly rather than rendering a wrong color.
 */
export function oklchToRgb(oklch: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(oklch.trim());
  if (!m) throw new Error(`oklchToRgb: not an oklch() color: ${oklch}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const hRad = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // oklab -> LMS (cube-rooted) -> linear sRGB (Björn Ottosson's matrices).
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  };
}

const channel = (x: number): string =>
  Math.round(clamp01(x) * 255)
    .toString(16)
    .padStart(2, '0');

/** Pack 0..1 sRGB components into a 0xRRGGBB integer (THREE.Color / hex consumers). */
export function rgbToHexNumber(rgb: Rgb): number {
  const r = Math.round(clamp01(rgb.r) * 255);
  const g = Math.round(clamp01(rgb.g) * 255);
  const b = Math.round(clamp01(rgb.b) * 255);
  return (r << 16) | (g << 8) | b;
}

/** Format 0..1 sRGB components as a `#rrggbb` CSS string. */
export function rgbToHexString(rgb: Rgb): string {
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}
