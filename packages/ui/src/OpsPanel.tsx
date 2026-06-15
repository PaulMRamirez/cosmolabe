// Operations panel: surfaces the scripting API (a guided tour), the mission
// plugin registry (a list of bundled missions), and the telemetry adapter (the
// latest predicted-versus-actual residual). Presentational: the app wires the
// handlers to the engine, registry, and store.

export interface MissionOption {
  readonly id: string;
  readonly name: string;
}

export interface OpsPanelProps {
  readonly missions: readonly MissionOption[];
  readonly onLoadMission: (id: string) => void;
  readonly onRunTour: () => void;
  /** Latest predicted-versus-actual residual (km), or null when no telemetry. */
  readonly telemetryResidualKm: number | null;
}

export function OpsPanel(props: OpsPanelProps): JSX.Element {
  return (
    <section className="bessel-ops" aria-label="Operations">
      <div className="bessel-ops-missions" role="group" aria-label="Missions">
        <span>Missions:</span>
        {props.missions.length === 0 ? (
          <span className="bessel-ops-empty">none bundled (load a catalog)</span>
        ) : (
          props.missions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => props.onLoadMission(m.id)}
              data-testid={`mission-${m.id}`}
            >
              {m.name}
            </button>
          ))
        )}
      </div>
      <button type="button" onClick={props.onRunTour} data-testid="run-tour">
        Guided tour
      </button>
      <div className="bessel-ops-telemetry" data-testid="telemetry-residual">
        {props.telemetryResidualKm === null
          ? 'Telemetry: none'
          : `Telemetry residual: ${props.telemetryResidualKm.toFixed(2)} km`}
      </div>
    </section>
  );
}
