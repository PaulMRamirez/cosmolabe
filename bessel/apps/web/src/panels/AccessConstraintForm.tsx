// The composable access constraint stack form (analysis-UX Phase 1/3): per-constraint toggles
// with their parameter bands, assembled into an AccessConstraintSpec the Access card runs
// through @bessel/access. The four constraints driven from the current scenario (line-of-sight,
// range, range-rate, sun keep-out) are live toggles; the facility-bound az/el mask is UNGATED in
// Phase 2 against the active ground station; and the terrain LOS is UNGATED in Phase 3 once a
// terrain SOURCE is chosen (the built-in deterministic SAMPLE ridge DEM, clearly labelled sample
// data). Controlled component over a plain spec (value + onChange); the panel owns the state.

import type { AccessConstraintSpec, TerrainSource } from '../engine/analysis-defaults.ts';

/** The selectable terrain DEM sources for the terrain-LOS constraint. 'none' leaves the toggle inert;
 *  'sample-ridge' is the built-in deterministic SAMPLE ridge heightfield (illustrative, not real). */
const TERRAIN_SOURCE_OPTIONS: readonly { readonly value: TerrainSource; readonly label: string }[] = [
  { value: 'none', label: 'None (no DEM)' },
  { value: 'sample-ridge', label: 'Sample ridge DEM (sample data)' },
];

/** A labelled checkbox toggle for one constraint kind, with the testid the e2e/unit tests read. */
function ConstraintToggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className="bessel-constraint-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={(ev) => props.onChange(ev.target.checked)}
        data-testid={props.testId}
      />
      {props.label}
    </label>
  );
}

/** A small numeric band input pair (min/max) shown when a constraint is enabled. */
function BandFields(props: {
  unit: string;
  min: number;
  max: number;
  step?: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
  minTestId: string;
  maxTestId: string;
}): JSX.Element {
  const onNum = (set: (v: number) => void) => (raw: string): void => {
    const n = Number(raw);
    if (Number.isFinite(n)) set(n);
  };
  return (
    <div className="bessel-constraint-band">
      <label>
        {`Min (${props.unit})`}
        <input
          type="number"
          step={props.step ?? 'any'}
          value={props.min}
          data-testid={props.minTestId}
          onChange={(ev) => onNum(props.onMin)(ev.target.value)}
        />
      </label>
      <label>
        {`Max (${props.unit})`}
        <input
          type="number"
          step={props.step ?? 'any'}
          value={props.max}
          data-testid={props.maxTestId}
          onChange={(ev) => onNum(props.onMax)(ev.target.value)}
        />
      </label>
    </div>
  );
}

export interface AccessConstraintFormProps {
  readonly value: AccessConstraintSpec;
  readonly onChange: (v: AccessConstraintSpec) => void;
  /** [ux-p2-access] The active ground station's name when one is selected, else null. The az/el
   *  mask toggle is UNGATED (live) when a station is active, and disabled with a hint otherwise. */
  readonly activeStationName?: string | null;
}

/** The constraint-stack form: four live toggles (each revealing its band when on), the station-bound
 *  az/el mask, and the terrain LOS (UNGATED once a terrain source is chosen). Assembles into the spec
 *  the Access card runs through computeAccess. */
export function AccessConstraintForm(props: AccessConstraintFormProps): JSX.Element {
  const { value, onChange } = props;
  const set = (patch: Partial<AccessConstraintSpec>): void => onChange({ ...value, ...patch });
  const stationActive = !!props.activeStationName;
  const terrainSourceChosen = value.terrainSource !== 'none';
  return (
    <div className="bessel-constraint-stack" data-testid="access-constraint-form">
      <ConstraintToggle
        label="Line of sight (not occulted by the center body)"
        checked={value.losEnabled}
        onChange={(v) => set({ losEnabled: v })}
        testId="constraint-los"
      />

      <ConstraintToggle
        label="Range gate"
        checked={value.rangeEnabled}
        onChange={(v) => set({ rangeEnabled: v })}
        testId="constraint-range"
      />
      {value.rangeEnabled ? (
        <BandFields
          unit="km"
          min={value.rangeMinKm}
          max={value.rangeMaxKm}
          onMin={(v) => set({ rangeMinKm: v })}
          onMax={(v) => set({ rangeMaxKm: v })}
          minTestId="param-range-min"
          maxTestId="param-range-max"
        />
      ) : null}

      <ConstraintToggle
        label="Range-rate band"
        checked={value.rangeRateEnabled}
        onChange={(v) => set({ rangeRateEnabled: v })}
        testId="constraint-rangerate"
      />
      {value.rangeRateEnabled ? (
        <BandFields
          unit="km/s"
          min={value.rangeRateMinKmS}
          max={value.rangeRateMaxKmS}
          onMin={(v) => set({ rangeRateMinKmS: v })}
          onMax={(v) => set({ rangeRateMaxKmS: v })}
          minTestId="param-rangerate-min"
          maxTestId="param-rangerate-max"
        />
      ) : null}

      <ConstraintToggle
        label="Sun keep-out"
        checked={value.sunKeepoutEnabled}
        onChange={(v) => set({ sunKeepoutEnabled: v })}
        testId="constraint-sunkeepout"
      />
      {value.sunKeepoutEnabled ? (
        <label className="bessel-constraint-band">
          Keep-out (deg)
          <input
            type="number"
            step="any"
            min={0.001}
            value={value.sunKeepoutDeg}
            data-testid="param-sunkeepout-deg"
            onChange={(ev) => {
              const n = Number(ev.target.value);
              if (Number.isFinite(n)) set({ sunKeepoutDeg: n });
            }}
          />
        </label>
      ) : null}

      {/* [ux-p2-access] Az/el horizon mask: UNGATED in Phase 2. Live when a ground station is active
          (it reads the station's facility + min-elevation floor); disabled with a hint otherwise. */}
      <ConstraintToggle
        label={
          stationActive
            ? `Az/el horizon mask at ${props.activeStationName}`
            : 'Az/el horizon mask (select a ground station in the context bar)'
        }
        checked={stationActive && value.azElMaskEnabled}
        disabled={!stationActive}
        onChange={(v) => set({ azElMaskEnabled: v })}
        testId="constraint-azelmask"
      />

      {/* [ux-p3-access] Terrain line of sight: UNGATED in Phase 3. Live once a terrain SOURCE is chosen
          (the built-in sample ridge DEM); the toggle's effect is inert while the source is 'none'. */}
      <fieldset className="bessel-constraint-advanced" data-testid="access-constraint-advanced">
        <legend>Terrain</legend>
        <label className="bessel-constraint-band">
          Terrain source
          <select
            value={value.terrainSource}
            data-testid="param-terrain-source"
            onChange={(ev) => set({ terrainSource: ev.target.value as TerrainSource })}
          >
            {TERRAIN_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <ConstraintToggle
          label={
            terrainSourceChosen
              ? 'Terrain line of sight (clear of the center body terrain)'
              : 'Terrain line of sight (choose a terrain source above)'
          }
          checked={terrainSourceChosen && value.terrainLosEnabled}
          disabled={!terrainSourceChosen}
          onChange={(v) => set({ terrainLosEnabled: v })}
          testId="constraint-terrainlos"
        />
        {value.terrainSource === 'sample-ridge' ? (
          <p className="bessel-loader-hint" data-testid="terrain-sample-note">
            Sample data: a synthetic ridge heightfield, not real terrain.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
