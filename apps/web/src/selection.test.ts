import { describe, it, expect } from 'vitest';
import { toggleSelection, isSelected, rollMeasurePair } from './selection.ts';

describe('multi-object selection', () => {
  it('adds and removes ids preserving order', () => {
    let sel: readonly string[] = [];
    sel = toggleSelection(sel, 'Saturn');
    sel = toggleSelection(sel, 'Cassini');
    expect(sel).toEqual(['Saturn', 'Cassini']);
    expect(isSelected(sel, 'Saturn')).toBe(true);
    sel = toggleSelection(sel, 'Saturn');
    expect(sel).toEqual(['Cassini']);
  });
});

describe('rollMeasurePair (Measure mode)', () => {
  it('keeps the most recent two distinct picks, rolling the oldest out', () => {
    let sel: readonly string[] = [];
    sel = rollMeasurePair(sel, 'Saturn');
    expect(sel).toEqual(['Saturn']);
    sel = rollMeasurePair(sel, 'Earth');
    expect(sel).toEqual(['Saturn', 'Earth']);
    sel = rollMeasurePair(sel, 'Mars');
    expect(sel).toEqual(['Earth', 'Mars']);
  });

  it('leaves the pair unchanged when re-picking an already-selected id', () => {
    expect(rollMeasurePair(['Earth', 'Mars'], 'Earth')).toEqual(['Earth', 'Mars']);
  });
});
