import { describe, it, expect } from 'vitest';
import { oklchToRgb, rgbToHexNumber, rgbToHexString } from './index.ts';

describe('oklchToRgb', () => {
  it('maps pure white and black at the achromatic poles', () => {
    const white = oklchToRgb('oklch(1 0 0)');
    expect(white.r).toBeCloseTo(1, 2);
    expect(white.g).toBeCloseTo(1, 2);
    expect(white.b).toBeCloseTo(1, 2);

    const black = oklchToRgb('oklch(0 0 0)');
    expect(black.r).toBeCloseTo(0, 2);
    expect(black.g).toBeCloseTo(0, 2);
    expect(black.b).toBeCloseTo(0, 2);
  });

  it('converts the selene amber token to a warm orange in sRGB', () => {
    // tokenValues.amber = oklch(0.80 0.15 70): a bright, warm amber. Red dominant,
    // green strong, blue low, matching the on-screen accent.
    const amber = oklchToRgb('oklch(0.80 0.15 70)');
    expect(amber.r).toBeGreaterThan(amber.g);
    expect(amber.g).toBeGreaterThan(amber.b);
    expect(amber.r).toBeGreaterThan(0.85);
    expect(amber.b).toBeLessThan(0.6);
  });

  it('places hue 145 (green) and 210 (cyan) on the expected dominant channels', () => {
    const green = oklchToRgb('oklch(0.78 0.14 145)');
    expect(green.g).toBeGreaterThan(green.r);
    expect(green.g).toBeGreaterThan(green.b);

    const cyan = oklchToRgb('oklch(0.78 0.11 210)');
    expect(cyan.b).toBeGreaterThan(cyan.r);
    expect(cyan.g).toBeGreaterThan(cyan.r);
  });

  it('tolerates an alpha suffix and surrounding whitespace', () => {
    const a = oklchToRgb('  oklch(0.80 0.15 70 / 0.5)  ');
    const b = oklchToRgb('oklch(0.80 0.15 70)');
    expect(a).toEqual(b);
  });

  it('throws loudly on a non-oklch string', () => {
    expect(() => oklchToRgb('#ffd27f')).toThrow(/not an oklch/);
  });
});

describe('rgb packing', () => {
  it('packs a hex number with channels in the right bytes', () => {
    expect(rgbToHexNumber({ r: 1, g: 0, b: 0 })).toBe(0xff0000);
    expect(rgbToHexNumber({ r: 0, g: 1, b: 0 })).toBe(0x00ff00);
    expect(rgbToHexNumber({ r: 0, g: 0, b: 1 })).toBe(0x0000ff);
  });

  it('clamps out-of-range components before packing', () => {
    expect(rgbToHexNumber({ r: 2, g: -1, b: 0.5 })).toBe(0xff0080);
  });

  it('formats a #rrggbb string', () => {
    expect(rgbToHexString({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgbToHexString({ r: 0, g: 0.5, b: 1 })).toBe('#0080ff');
  });
});
