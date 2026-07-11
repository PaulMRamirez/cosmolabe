// Lazy-loaded workbench and menu panels. Each panel (and the heavy code it pulls:
// @bessel/interop CSV/OEM writers, the @bessel/spice provider catalog, the charting
// primitives, and, on first interaction, the analysis-ops chunk via the engine) is
// split into its own on-demand chunk through React.lazy. The viewer renders these only
// inside an open Popover, so a panel's chunk is fetched the first time its menu opens,
// not at first paint. The always-present chrome (menu bar, object browser, settings,
// readouts) stays statically imported. React.lazy needs a default export, so each
// dynamic import maps the panel's named export to `default`.

import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

/** An accessible, labelled loading indicator used as the Suspense fallback while a
 * panel chunk loads, so the axe scan stays clean (no unlabelled busy region). */
export function PanelFallback(): JSX.Element {
  return (
    <div
      className="bessel-panel-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading panel"
      data-testid="panel-loading"
    >
      Loading...
    </div>
  );
}

/** Wrap a lazily-loaded panel in a Suspense boundary with the accessible fallback. */
export function withPanelSuspense<P extends object>(
  Component: ComponentType<P>,
): (props: P) => JSX.Element {
  return function Suspended(props: P): JSX.Element {
    return (
      <Suspense fallback={<PanelFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

/** Render arbitrary lazy children under the shared accessible fallback. */
export function PanelSuspense(props: { children: ReactNode }): JSX.Element {
  return <Suspense fallback={<PanelFallback />}>{props.children}</Suspense>;
}

// The six intent-named domain panels of the analysis-UX re-slot. Each is its own
// on-demand chunk; the propagation / mission / OD / report / compare bodies are imported
// statically inside the composing domain panels, so they ride in the same lazy chunk and
// never enter the first-paint shell.
export const OrbitManeuverPanel = lazy(() =>
  import('./OrbitManeuverPanel.tsx').then((m) => ({ default: m.OrbitManeuverPanel })),
);
export const LightingGeometryPanel = lazy(() =>
  import('./LightingGeometryPanel.tsx').then((m) => ({ default: m.LightingGeometryPanel })),
);
export const AccessCommsPanel = lazy(() =>
  import('./AccessCommsPanel.tsx').then((m) => ({ default: m.AccessCommsPanel })),
);
export const ConjunctionPanel = lazy(() =>
  import('./ConjunctionPanel.tsx').then((m) => ({ default: m.ConjunctionPanel })),
);
export const CoveragePanel = lazy(() =>
  import('./CoveragePanel.tsx').then((m) => ({ default: m.CoveragePanel })),
);
export const GrammarPanel = lazy(() =>
  import('./GrammarPanel.tsx').then((m) => ({ default: m.GrammarPanel })),
);
export const ReportComparePanel = lazy(() =>
  import('./ReportComparePanel.tsx').then((m) => ({ default: m.ReportComparePanel })),
);

// The shell menus surfaced from @bessel/ui. They are lightweight but only appear inside
// an open menu, so loading them on first open keeps them out of the first render tree.
export const ScriptConsole = lazy(() =>
  import('@bessel/ui').then((m) => ({ default: m.ScriptConsole })),
);
export const TelemetryOverlay = lazy(() =>
  import('@bessel/ui').then((m) => ({ default: m.TelemetryOverlay })),
);
