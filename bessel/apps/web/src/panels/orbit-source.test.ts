// The TLE-source parse is a pure, tested function: a valid 2- or 3-line set yields a typed
// TleSource, and a malformed set fails loudly with the located parser message (never a silent
// fallback to bundled sample data). (analysis-UX Phase 1.)

import { describe, expect, it } from 'vitest';
import { parseTleSource } from './orbit-source.ts';

// A valid checksummed TLE (the SGP4-VER catalog-5 case), used as the parse fixture.
const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

describe('parseTleSource', () => {
  it('parses a bare two-line set and names it from the catalog number', () => {
    const result = parseTleSource(`${L1}\n${L2}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.kind).toBe('tle');
      expect(result.source.line1).toBe(L1);
      expect(result.source.line2).toBe(L2);
      expect(result.source.name).toBe('TLE 5');
    }
  });

  it('uses a leading name line when a 3-line set is pasted', () => {
    const result = parseTleSource(`VANGUARD 1\n${L1}\n${L2}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.name).toBe('VANGUARD 1');
  });

  it('tolerates blank lines and trailing whitespace around the element lines', () => {
    const result = parseTleSource(`\n${L1}  \n${L2}\n\n`);
    expect(result.ok).toBe(true);
  });

  it('fails loudly with a message when fewer than two lines are pasted', () => {
    const result = parseTleSource(L1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('two lines');
  });

  it('surfaces the located parser error on a bad checksum (no silent fallback)', () => {
    // Corrupt the line-1 checksum digit (last column) so parseTle rejects it.
    const badL1 = `${L1.slice(0, 68)}0`;
    const result = parseTleSource(`${badL1}\n${L2}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain('checksum');
  });
});
