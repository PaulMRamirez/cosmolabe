// @bessel/color: named color strategies mapping a scalar to a color ramp.
// Home of the Cosmographia colorScheme / colorByDistance hook (ADR-0006).

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// oklch -> sRGB conversion, for turning oklch design tokens into WebGL/hex colors.
export { oklchToRgb, rgbToHexNumber, rgbToHexString } from './oklch.ts';

/** Maps a scalar (distance, phase angle, parameter value) to a color. */
export interface ColorStrategy {
  readonly name: string;
  color(value: number, domain: readonly [number, number]): Rgb;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A simple two-stop linear ramp, the default strategy. */
export function linearRamp(name: string, from: Rgb, to: Rgb): ColorStrategy {
  return {
    name,
    color(value, [lo, hi]) {
      const t = hi === lo ? 0 : clamp01((value - lo) / (hi - lo));
      return {
        r: from.r + (to.r - from.r) * t,
        g: from.g + (to.g - from.g) * t,
        b: from.b + (to.b - from.b) * t,
      };
    },
  };
}

const registry = new Map<string, ColorStrategy>();

export function registerStrategy(strategy: ColorStrategy): void {
  registry.set(strategy.name, strategy);
}

export function getStrategy(name: string): ColorStrategy | undefined {
  return registry.get(name);
}

registerStrategy(linearRamp('grayscale', { r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }));
