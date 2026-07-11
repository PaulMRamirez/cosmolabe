// Mission-profile presets: a per-persona accelerator layered over the workflow IA
// (analysis-UX goal, decision 2). It is NOT a separate mode and hides nothing; every
// tab and TaskCard stays reachable normally. Selecting a preset (a) switches to that
// persona's home tab and (b) pre-expands that persona's primary TaskCards through the
// same expandRequest path the AnalysisLauncher already uses. Deliberately tiny: a static
// array of {preset -> tab + cardIds} grounded in the real tabs/cards, no engine or heavy
// code, so it stays out of the first-paint shell budget.

import type { AnalyzeTab } from '../store/index.ts';

/** The five mission profiles surfaced as accelerator chips. */
export type MissionPreset = 'SSA' | 'Comms' | 'Coverage' | 'Mission design' | 'Observation';

/** One preset: the persona label, its home tab, and the primary TaskCards to pre-expand.
 *  Card ids match the panel TaskCards; the list is ordered most-important-last because the
 *  accordion keeps the most recent ids under its at-most-two-expanded cap. */
export interface PresetEntry {
  readonly preset: MissionPreset;
  readonly tab: AnalyzeTab;
  readonly cardIds: readonly string[];
}

/** The static preset registry. Each preset maps to a valid AnalyzeTab plus card ids that
 *  exist on that tab's panel, grounded in the design's per-persona inner loops:
 *  - SSA: conjunction catalog screening + per-event closest approach.
 *  - Comms: the access tab's downlink budget worksheet.
 *  - Coverage: the Walker designer feeding the coverage grid sweep.
 *  - Mission design: orbit propagation feeding the mission control sequence.
 *  - Observation: the access tab's in-FOV observation windows. */
export const PRESET_REGISTRY: readonly PresetEntry[] = [
  { preset: 'SSA', tab: 'conjunction', cardIds: ['catalog-screen', 'closest-approach'] },
  { preset: 'Comms', tab: 'access-comms', cardIds: ['link'] },
  { preset: 'Coverage', tab: 'coverage', cardIds: ['constellation', 'coverage-grid'] },
  { preset: 'Mission design', tab: 'orbit-maneuver', cardIds: ['propagate', 'mcs'] },
  { preset: 'Observation', tab: 'access-comms', cardIds: ['in-fov'] },
];

export interface PresetBarProps {
  /** The last-applied preset, or null after any non-preset navigation. Marks exactly
   *  that chip pressed (keying off the tab would light BOTH chips that share a tab,
   *  e.g. Comms and Observation both live on access-comms). */
  readonly activePreset: MissionPreset | null;
  /** Apply a preset: switch to its tab and pre-expand its primary cards. */
  readonly onPreset: (entry: PresetEntry) => void;
}

/** A row of mission-profile chips (real buttons, keyboard and screen-reader operable).
 *  The last-applied chip reads aria-pressed; presets are an accelerator only, so the
 *  pressed state is a hint, not an exclusive mode, and clears on other navigation. */
export function PresetBar(props: PresetBarProps): JSX.Element {
  return (
    <div
      className="bessel-mission-presets"
      data-testid="mission-presets"
      role="group"
      aria-label="Mission-profile presets"
    >
      {PRESET_REGISTRY.map((entry) => (
        <button
          key={entry.preset}
          type="button"
          className="bessel-mission-preset"
          aria-pressed={props.activePreset === entry.preset}
          data-testid={`mission-preset-${entry.preset}`}
          title={`Open the ${entry.preset} workflow and expand its primary tasks`}
          onClick={() => props.onPreset(entry)}
        >
          {entry.preset}
        </button>
      ))}
    </div>
  );
}
