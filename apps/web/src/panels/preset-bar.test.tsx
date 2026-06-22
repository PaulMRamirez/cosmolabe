import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { PresetBar, PRESET_REGISTRY, type MissionPreset } from './PresetBar.tsx';
import { LAUNCHER_REGISTRY } from './AnalysisLauncher.tsx';
import type { AnalyzeTab } from '../store/index.ts';

// Mission-profile presets are an accelerator layered over the workflow IA: each preset
// opens a persona's home tab and pre-expands that persona's primary cards. The registry is
// the only data the bar reads (no engine), so its shape and the chip render are unit-tested.

const ALL_TABS: readonly AnalyzeTab[] = [
  'orbit-maneuver',
  'lighting-geometry',
  'access-comms',
  'conjunction',
  'coverage',
  'report-compare',
];

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('PRESET_REGISTRY', () => {
  it('exposes the five mission profiles, each once', () => {
    const presets = PRESET_REGISTRY.map((e) => e.preset);
    const expected: readonly MissionPreset[] = ['SSA', 'Comms', 'Coverage', 'Mission design', 'Observation'];
    for (const p of expected) expect(presets).toContain(p);
    expect(new Set(presets).size).toBe(presets.length);
    expect(presets.length).toBe(5);
  });

  it('maps every preset to a real tab and to card ids that live on that tab', () => {
    // The launcher registry enumerates the real TaskCard ids per tab; cross-check against it
    // so a preset can never point at a card that does not exist on its tab.
    const cardsByTab = new Map<AnalyzeTab, Set<string>>();
    for (const entry of LAUNCHER_REGISTRY) {
      const set = cardsByTab.get(entry.tab) ?? new Set<string>();
      set.add(entry.id);
      cardsByTab.set(entry.tab, set);
    }
    for (const preset of PRESET_REGISTRY) {
      expect(ALL_TABS).toContain(preset.tab);
      expect(preset.cardIds.length).toBeGreaterThan(0);
      const onTab = cardsByTab.get(preset.tab);
      expect(onTab).toBeDefined();
      for (const id of preset.cardIds) {
        expect(onTab?.has(id)).toBe(true);
      }
    }
  });

  it('keeps each preset within the at-most-two-expanded accordion cap', () => {
    for (const preset of PRESET_REGISTRY) {
      expect(preset.cardIds.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('PresetBar', () => {
  it('renders the mission-presets group with a chip per preset', () => {
    const out = html(createElement(PresetBar, { activeTab: 'orbit-maneuver', onPreset: () => undefined }));
    expect(out).toContain('data-testid="mission-presets"');
    for (const entry of PRESET_REGISTRY) {
      expect(out).toContain(`data-testid="mission-preset-${entry.preset}"`);
    }
  });

  it('uses real buttons and marks the active tab preset as pressed', () => {
    // On the conjunction tab the SSA chip (tab=conjunction) reads aria-pressed=true; the
    // Comms chip (tab=access-comms) reads false. The chip's aria-pressed and data-testid sit
    // on the same <button>, so match the attributes within one tag (order-independent).
    const out = html(createElement(PresetBar, { activeTab: 'conjunction', onPreset: () => undefined }));
    expect(out).toMatch(/<button[^>]*type="button"/);
    const tagFor = (preset: string): string | undefined =>
      out.match(new RegExp(`<button[^>]*data-testid="mission-preset-${preset}"[^>]*>`))?.[0];
    expect(tagFor('SSA')).toContain('aria-pressed="true"');
    expect(tagFor('Comms')).toContain('aria-pressed="false"');
  });
});
