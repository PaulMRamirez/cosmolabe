import { describe, it, expect } from 'vitest';
import { LAUNCHER_REGISTRY, LAUNCHER_DOMAINS, filterLauncher } from './AnalysisLauncher.tsx';

// The AnalysisLauncher filters a static card registry by intent keyword. The registry is
// the only data the search reads (no engine), so its shape and the filter are unit-tested.

describe('AnalysisLauncher registry', () => {
  it('covers every domain tab and uses card ids that match the panel TaskCards', () => {
    const tabs = new Set(LAUNCHER_REGISTRY.map((e) => e.tab));
    for (const tab of [
      'orbit-maneuver',
      'lighting-geometry',
      'access-comms',
      'conjunction',
      'coverage',
      'report-compare',
    ]) {
      expect(tabs.has(tab as never)).toBe(true);
    }
    // Ids are unique so a launch maps to exactly one card.
    const ids = LAUNCHER_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('filterLauncher', () => {
  it('matches on intent keyword and routes to the owning tab', () => {
    const eclipse = filterLauncher('eclipse');
    expect(eclipse.map((e) => e.id)).toContain('eclipse');
    expect(eclipse.find((e) => e.id === 'eclipse')?.tab).toBe('lighting-geometry');

    const link = filterLauncher('downlink');
    expect(link.map((e) => e.id)).toContain('link');
    expect(link.find((e) => e.id === 'link')?.tab).toBe('access-comms');
  });

  it('matches the visible title too', () => {
    expect(filterLauncher('Walker').map((e) => e.id)).toContain('constellation');
  });

  it('returns nothing for an empty query (the dropdown stays closed)', () => {
    expect(filterLauncher('')).toEqual([]);
    expect(filterLauncher('   ')).toEqual([]);
  });
});

describe('LAUNCHER_DOMAINS', () => {
  it('lists one distinct label per registry tab, in registry order, for the empty/no-match hint', () => {
    // One entry per distinct tab: the hint never repeats a domain.
    const distinctTabs = new Set(LAUNCHER_REGISTRY.map((e) => e.tab));
    expect(LAUNCHER_DOMAINS.length).toBe(distinctTabs.size);
    expect(new Set(LAUNCHER_DOMAINS).size).toBe(LAUNCHER_DOMAINS.length);
    // The first registry tab is orbit & maneuver, so its label leads the hint.
    expect(LAUNCHER_DOMAINS[0]).toBe('orbit & maneuver');
  });
});
