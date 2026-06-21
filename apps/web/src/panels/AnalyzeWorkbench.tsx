// The consolidated analysis workbench: one pinnable, tabbed right-dock that replaces
// the six former top-bar analysis popovers (Propagate, Mission Design, OD, Report,
// Analysis, Telemetry). It fills the AppShell 'right' slot, so the canvas reclaims the
// width when it is closed. Unlike a popover it does NOT auto-dismiss: results survive
// canvas clicks, timeline scrubbing, and tab switches (each panel reads its result from
// the store, so switching tabs re-renders from state with no recompute). Each tab body
// stays lazy (panels/lazy.tsx), so the first-paint shell budget is unaffected.

import { useCallback, type KeyboardEvent } from 'react';
import { AnalysisContextBar } from './AnalysisContextBar.tsx';
import {
  AnalysisPanel,
  MissionPanel,
  OdPanel,
  PanelSuspense,
  PropagatePanel,
  ReportPanel,
  TelemetryOverlay,
} from './lazy.tsx';
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

const TABS: readonly { readonly id: AnalyzeTab; readonly label: string }[] = [
  { id: 'propagation', label: 'Propagation' },
  { id: 'maneuver', label: 'Maneuver' },
  { id: 'od', label: 'OD' },
  { id: 'access', label: 'Access & Coverage' },
  { id: 'report', label: 'Report' },
  { id: 'compare', label: 'Compare' },
];

export function AnalyzeWorkbench(props: AnalyzeWorkbenchProps): JSX.Element {
  const { engine, store, activeTab, onTab } = props;

  const onKeyNav = useCallback(
    (ev: KeyboardEvent<HTMLDivElement>): void => {
      const i = TABS.findIndex((t) => t.id === activeTab);
      if (ev.key === 'ArrowRight') onTab(TABS[(i + 1) % TABS.length]!.id);
      else if (ev.key === 'ArrowLeft') onTab(TABS[(i - 1 + TABS.length) % TABS.length]!.id);
    },
    [activeTab, onTab],
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
            onClick={() => onTab(t.id)}
          >
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
        <PanelSuspense>
          {activeTab === 'propagation' && <PropagatePanel engine={engine} store={store} />}
          {activeTab === 'maneuver' && <MissionPanel engine={engine} store={store} />}
          {activeTab === 'od' && <OdPanel engine={engine} store={store} />}
          {activeTab === 'access' && (
            <AnalysisPanel engine={engine} store={store} hasSpacecraft={props.hasSpacecraft} />
          )}
          {activeTab === 'report' && <ReportPanel engine={engine} store={store} />}
          {activeTab === 'compare' && (
            <>
              {!props.hasSpacecraft ? (
                <p className="bessel-loader-hint" data-testid="telemetry-empty-notice">
                  Load a spacecraft to analyze.
                </p>
              ) : null}
              <TelemetryOverlay
                series={props.telemetryOverlay}
                nowEt={props.et}
                fault={props.telemetryFault}
              />
            </>
          )}
        </PanelSuspense>
      </div>
    </section>
  );
}
