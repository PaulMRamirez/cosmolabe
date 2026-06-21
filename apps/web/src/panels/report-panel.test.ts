import { describe, it, expect } from 'vitest';
import { reconcileName } from './ReportPanel.tsx';

describe('ReportPanel reconcileName', () => {
  const names = ['Sun', 'Earth', 'Mars'];

  it('keeps a selection that still exists in the current options', () => {
    expect(reconcileName('Earth', names, 0, 'Sun')).toBe('Earth');
  });

  it('falls back to the indexed name when the held selection is gone', () => {
    // After loading a different mission, a stale name absent from the new options must
    // not survive: observer reconciles to names[0], target to names[1].
    expect(reconcileName('Cassini', names, 0, 'Sun')).toBe('Sun');
    expect(reconcileName('Saturn', names, 1, 'Earth')).toBe('Earth');
  });

  it('falls back to the first name, then the default, when the index is out of range', () => {
    expect(reconcileName('Cassini', ['Mercury'], 1, 'Earth')).toBe('Mercury');
    expect(reconcileName('Cassini', [], 1, 'Earth')).toBe('Earth');
  });
});
