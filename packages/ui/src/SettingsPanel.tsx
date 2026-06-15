// Visualization settings panel: toggles for the scene layers. Presentational; the
// viewer maps each change to the scene visibility seams.

export interface VisualizationSettings {
  readonly trajectory: boolean;
  readonly orbits: boolean;
  readonly labels: boolean;
  readonly fov: boolean;
  readonly footprint: boolean;
  readonly axes: boolean;
  readonly stars: boolean;
  readonly atmosphere: boolean;
  readonly shadows: boolean;
}

export type SettingKey = keyof VisualizationSettings;

export interface SettingsPanelProps {
  readonly settings: VisualizationSettings;
  readonly onChange: (key: SettingKey, value: boolean) => void;
}

const LABELS: Record<SettingKey, string> = {
  trajectory: 'Trajectory',
  orbits: 'Orbits',
  labels: 'Labels',
  fov: 'Sensor FOV',
  footprint: 'Footprint',
  axes: 'Frame axes',
  stars: 'Star field',
  atmosphere: 'Atmosphere',
  shadows: 'Shadows',
};

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const keys = Object.keys(LABELS) as SettingKey[];
  return (
    <fieldset className="bessel-settings" aria-label="Visualization settings">
      <legend>Visualization</legend>
      {keys.map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={props.settings[key]}
            onChange={(e) => props.onChange(key, e.target.checked)}
            data-testid={`setting-${key}`}
          />
          {LABELS[key]}
        </label>
      ))}
    </fieldset>
  );
}
