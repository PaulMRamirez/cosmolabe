// The consolidated analysis workbench: one pinnable, tabbed right-dock that hosts the six
// intent-named analysis domain tabs of the analysis-UX re-slot (design section 3): Orbit &
// Maneuver (OD folded in), Lighting & Geometry, Access & Comms, Conjunction, Coverage &
// Constellation, and the cross-cutting Report & Compare sink. It fills the AppShell 'right'
// slot, so the canvas reclaims the width when it is closed. Unlike a popover it does NOT
// auto-dismiss: results survive canvas clicks, timeline scrubbing, and tab switches (each
// panel reads its result from the store, so switching tabs re-renders from state with no
// recompute). Each tab body stays lazy (panels/lazy.tsx), so the first-paint shell budget
// is unaffected. A top-of-dock AnalysisLauncher searches a static card registry and, on a
// hit, switches to the owning tab and expands the card. A PresetBar of mission-profile
// chips is the per-persona accelerator: selecting a preset switches to that persona's home
// tab and pre-expands its primary cards through the same expandRequest path the launcher
// uses. The presets hide nothing; every tab and card stays reachable normally.

import { useCallback, useState, type KeyboardEvent } from 'react';
import { Icon, DomainIcon } from '@bessel/selene-design';
import { AnalysisContextBar } from './AnalysisContextBar.tsx';
import { AnalysisLauncher, type LauncherEntry } from './AnalysisLauncher.tsx';
import { PresetBar, type PresetEntry, type MissionPreset } from './PresetBar.tsx';
import {
  AccessCommsPanel,
  ConjunctionPanel,
  CoveragePanel,
  GrammarPanel,
  LightingGeometryPanel,
  OrbitManeuverPanel,
  PanelSuspense,
  ReportComparePanel,
} from './lazy.tsx';
import type { ExpandRequest } from './TaskCard.tsx';
import type { BesselEngine } from '../engine/index.ts';
import type { AppStore, AnalyzeTab } from '../store/index.ts';
import type { PredictedVsActual } from '@bessel/state';

export interface AnalyzeWorkbenchProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly activeTab: AnalyzeTab;
  readonly onTab: (tab: AnalyzeTab) => void;
  readonly onClose: () => void;
  readonly telemetryOverlay: readonly PredictedVsActual[];
  readonly et: number;
  readonly telemetryFault: string | null;
}

// Each tab carries a concept icon: a bespoke domain glyph where one fits (propagate,
// eclipse, conjunction, walker), a universal Lucide glyph where it does not (comms,
// report). The icon is decorative; the visible label remains the accessible name.
const TABS: readonly { readonly id: AnalyzeTab; readonly label: string; readonly icon: JSX.Element }[] = [
  { id: 'orbit-maneuver', label: 'Orbit & Maneuver', icon: <DomainIcon name="propagate" size="sm" /> },
  { id: 'lighting-geometry', label: 'Lighting & Geometry', icon: <DomainIcon name="eclipse" size="sm" /> },
  { id: 'access-comms', label: 'Access & Comms', icon: <Icon name="share" size="sm" /> },
  { id: 'conjunction', label: 'Conjunction', icon: <DomainIcon name="conjunction" size="sm" /> },
  { id: 'coverage', label: 'Coverage & Constellation', icon: <DomainIcon name="walker-constellation" size="sm" /> },
  { id: 'grammar', label: 'Jobs (M-0008 demo)', icon: <Icon name="chart" size="sm" /> },
  { id: 'report-compare', label: 'Report & Compare', icon: <Icon name="chart" size="sm" /> },
];

export function AnalyzeWorkbench(props: AnalyzeWorkbenchProps): JSX.Element {
  const { engine, store, activeTab, onTab } = props;

  // The launcher writes a per-tab expand request. The token makes a repeated id re-fire;
  // we only pass the request to the panel that owns it, so other panels stay untouched.
  const [launch, setLaunch] = useState<{ tab: AnalyzeTab; req: ExpandRequest } | null>(null);
  // The last-applied preset, so its chip alone reads pressed. Cleared on any non-preset
  // navigation (a tab click, an arrow move, a launcher jump), since those leave the
  // preset's pre-expanded context. Keying off the tab would light both chips on a shared
  // tab (Comms and Observation are both access-comms).
  const [activePreset, setActivePreset] = useState<MissionPreset | null>(null);
  // Switch tabs through one helper so direct navigation always clears the active preset.
  const selectTab = useCallback(
    (tab: AnalyzeTab): void => {
      setActivePreset(null);
      onTab(tab);
    },
    [onTab],
  );
  const onLaunch = useCallback(
    (entry: LauncherEntry): void => {
      setActivePreset(null);
      onTab(entry.tab);
      setLaunch((prev) => ({ tab: entry.tab, req: { id: entry.id, token: (prev?.req.token ?? 0) + 1 } }));
    },
    [onTab],
  );
  // A mission-profile preset is an accelerator over the same path: switch to the persona's
  // home tab and pre-expand its primary cards (an ExpandRequest carrying the ordered ids).
  const onPreset = useCallback(
    (entry: PresetEntry): void => {
      setActivePreset(entry.preset);
      onTab(entry.tab);
      setLaunch((prev) => ({
        tab: entry.tab,
        req: { id: entry.cardIds, token: (prev?.req.token ?? 0) + 1 },
      }));
    },
    [onTab],
  );
  const reqFor = (tab: AnalyzeTab): ExpandRequest | undefined =>
    launch && launch.tab === tab ? launch.req : undefined;

  const onKeyNav = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>): void => {
      const i = TABS.findIndex((t) => t.id === activeTab);
      if (ev.key === 'ArrowRight') selectTab(TABS[(i + 1) % TABS.length]!.id);
      else if (ev.key === 'ArrowLeft') selectTab(TABS[(i - 1 + TABS.length) % TABS.length]!.id);
    },
    [activeTab, selectTab],
  );

  return (
    <section className="bessel-workbench" data-testid="analyze-workbench">
      <div className="bessel-workbench-header">
        <h2 className="bessel-panel-title">Analyze</h2>
        <button
          type="button"
          className="bessel-workbench-close"
          data-testid="analyze-close"
          aria-label="Close analysis dock"
          onClick={props.onClose}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <AnalysisContextBar engine={engine} store={store} />
      <div className="bessel-tabs" role="tablist" aria-label="Analysis tools" onKeyDown={onKeyNav}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            className="bessel-tab"
            aria-selected={activeTab === t.id}
            aria-controls="analyze-tabpanel"
            tabIndex={activeTab === t.id ? 0 : -1}
            data-testid={`tab-${t.id}`}
            onClick={() => selectTab(t.id)}
          >
            <span className="bessel-tab-icon" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="bessel-tabpanel"
        id="analyze-tabpanel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        data-testid="analyze-tabpanel"
        tabIndex={0}
      >
        <PresetBar activePreset={activePreset} onPreset={onPreset} />
        <AnalysisLauncher onLaunch={onLaunch} />
        <PanelSuspense>
          {activeTab === 'orbit-maneuver' && (
            <OrbitManeuverPanel
              engine={engine}
              store={store}
              {...(reqFor('orbit-maneuver') ? { expandRequest: reqFor('orbit-maneuver') } : {})}
            />
          )}
          {activeTab === 'lighting-geometry' && (
            <LightingGeometryPanel
              engine={engine}
              store={store}
              hasSpacecraft={props.hasSpacecraft}
              {...(reqFor('lighting-geometry') ? { expandRequest: reqFor('lighting-geometry') } : {})}
            />
          )}
          {activeTab === 'access-comms' && (
            <AccessCommsPanel
              engine={engine}
              store={store}
              hasSpacecraft={props.hasSpacecraft}
              {...(reqFor('access-comms') ? { expandRequest: reqFor('access-comms') } : {})}
            />
          )}
          {activeTab === 'conjunction' && (
            <ConjunctionPanel
              engine={engine}
              store={store}
              hasSpacecraft={props.hasSpacecraft}
              {...(reqFor('conjunction') ? { expandRequest: reqFor('conjunction') } : {})}
            />
          )}
          {activeTab === 'coverage' && (
            <CoveragePanel
              engine={engine}
              store={store}
              hasSpacecraft={props.hasSpacecraft}
              {...(reqFor('coverage') ? { expandRequest: reqFor('coverage') } : {})}
            />
          )}
          {activeTab === 'grammar' && (
            <GrammarPanel engine={engine} store={store} />
          )}
          {activeTab === 'report-compare' && (
            <ReportComparePanel
              engine={engine}
              store={store}
              hasSpacecraft={props.hasSpacecraft}
              telemetryOverlay={props.telemetryOverlay}
              et={props.et}
              telemetryFault={props.telemetryFault}
              {...(reqFor('report-compare') ? { expandRequest: reqFor('report-compare') } : {})}
            />
          )}
        </PanelSuspense>
      </div>
    </section>
  );
}
