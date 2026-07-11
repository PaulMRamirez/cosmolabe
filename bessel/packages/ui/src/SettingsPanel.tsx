// Visualization settings panel: toggles for the scene layers. Presentational; the
// viewer maps each change to the scene visibility seams.

import { Button } from '@bessel/selene-design';

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
  /** Fetch and apply real equirectangular planetary imagery (else procedural). */
  readonly realImagery: boolean;
}

export type SettingKey = keyof VisualizationSettings;

export interface SettingsPanelProps {
  readonly settings: VisualizationSettings;
  readonly onChange: (key: SettingKey, value: boolean) => void;
  /** When provided, render a "Reset to defaults" button; the parent owns the reset. */
  readonly onReset?: () => void;
  /** When provided, render a toggle for the live-geometry readout strip (so a user
   *  who dismissed it from the canvas can bring it back). The parent owns the state. */
  readonly showLiveGeometry?: boolean;
  readonly onToggleLiveGeometry?: (value: boolean) => void;
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
  realImagery: 'Real imagery',
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
      {props.onToggleLiveGeometry && (
        <label>
          <input
            type="checkbox"
            checked={props.showLiveGeometry ?? true}
            onChange={(e) => props.onToggleLiveGeometry?.(e.target.checked)}
            data-testid="setting-live-geometry"
          />
          Live geometry readout
        </label>
      )}
      {props.onReset && (
        <Button variant="secondary" testId="settings-reset" onClick={props.onReset}>
          Reset to defaults
        </Button>
      )}
    </fieldset>
  );
}
