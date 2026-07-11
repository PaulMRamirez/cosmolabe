import { describe, it, expect } from 'vitest';
import { isValidWalker } from './analysis-tool-forms.tsx';

describe('isValidWalker', () => {
  it('accepts a positive T that is an exact multiple of P', () => {
    expect(isValidWalker(24, 3)).toBe(true);
    expect(isValidWalker(6, 6)).toBe(true);
    expect(isValidWalker(1, 1)).toBe(true);
  });

  it('rejects a T not divisible by P (the case that throws in walkerConstellation)', () => {
    expect(isValidWalker(24, 5)).toBe(false);
    expect(isValidWalker(7, 2)).toBe(false);
  });

  it('rejects non-positive, zero, or non-integer T/P', () => {
    expect(isValidWalker(0, 3)).toBe(false);
    expect(isValidWalker(24, 0)).toBe(false);
    expect(isValidWalker(-24, 3)).toBe(false);
    expect(isValidWalker(24.5, 3)).toBe(false);
    expect(isValidWalker(Number.NaN, 3)).toBe(false);
  });
});
