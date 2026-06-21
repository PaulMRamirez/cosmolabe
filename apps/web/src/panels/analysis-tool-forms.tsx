// The per-tool parameter forms for the analysis workbench, extracted from AnalysisPanel
// so the panel stays near its soft cap. Each form is a controlled component over a plain
// param object (value + onChange-merge); the panel owns the state and passes the assembled
// object to the matching engine method. Presentational: no engine or store access.

import type { ReactNode } from 'react';

/** A labelled number input that reports its parsed value, clamped to an optional minimum. */
function NumField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
  min?: number;
  step?: number;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <input
        type="number"
        value={props.value}
        min={props.min}
        step={props.step ?? 'any'}
        data-testid={props.testId}
        onChange={(ev) => {
          const n = Number(ev.target.value);
          props.onChange(props.min !== undefined ? Math.max(props.min, n) : n);
        }}
      />
    </label>
  );
}

/** A labelled select over a fixed set of string options. */
function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (v: T) => void;
  testId: string;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <select value={props.value} data-testid={props.testId} onChange={(ev) => props.onChange(ev.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A param fieldset wrapper: a labelled group around a tool's inputs. */
function Fields(props: { testId: string; children: ReactNode }): JSX.Element {
  return (
    <div className="bessel-tool-params" data-testid={props.testId}>
      {props.children}
    </div>
  );
}

/** Downlink radio parameters (UI units: GHz). Converted to Hz at the call site. */
export interface LinkParams {
  eirpDbW: number;
  freqGHz: number;
  gOverTDbK: number;
  dataRateBps: number;
}

export const DEFAULT_LINK_PARAMS: LinkParams = { eirpDbW: 90, freqGHz: 8.4, gOverTDbK: 53, dataRateBps: 14_000 };

export function LinkParamsForm(props: { value: LinkParams; onChange: (v: LinkParams) => void }): JSX.Element {
  const { value: v, onChange } = props;
  return (
    <Fields testId="link-params">
      <NumField label="EIRP (dBW)" value={v.eirpDbW} testId="param-link-eirp" onChange={(eirpDbW) => onChange({ ...v, eirpDbW })} />
      <NumField label="Freq (GHz)" value={v.freqGHz} min={0.001} testId="param-link-freq" onChange={(freqGHz) => onChange({ ...v, freqGHz })} />
      <NumField label="G/T (dB/K)" value={v.gOverTDbK} testId="param-link-gt" onChange={(gOverTDbK) => onChange({ ...v, gOverTDbK })} />
      <NumField label="Data rate (bps)" value={v.dataRateBps} min={1} testId="param-link-rate" onChange={(dataRateBps) => onChange({ ...v, dataRateBps })} />
    </Fields>
  );
}

/** Conjunction encounter covariance (per-axis sigma, combined hard-body radius), in km. */
export interface ConjunctionParams {
  sigmaKm: number;
  radiusKm: number;
}

export const DEFAULT_CONJUNCTION_PARAMS: ConjunctionParams = { sigmaKm: 1, radiusKm: 0.1 };

export function ConjunctionParamsForm(props: {
  value: ConjunctionParams;
  onChange: (v: ConjunctionParams) => void;
}): JSX.Element {
  const { value: v, onChange } = props;
  return (
    <Fields testId="conjunction-params">
      <NumField label="Sigma (km)" value={v.sigmaKm} min={0.0001} testId="param-conj-sigma" onChange={(sigmaKm) => onChange({ ...v, sigmaKm })} />
      <NumField label="Hard-body R (km)" value={v.radiusKm} min={0.0001} testId="param-conj-radius" onChange={(radiusKm) => onChange({ ...v, radiusKm })} />
    </Fields>
  );
}

/** Walker constellation parameters (T/P/F, inclination deg, altitude km, pattern). */
export interface ConstellationFormParams {
  totalSats: number;
  planes: number;
  phasing: number;
  inclinationDeg: number;
  altitudeKm: number;
  pattern: 'delta' | 'star';
}

export const DEFAULT_CONSTELLATION_PARAMS: ConstellationFormParams = {
  totalSats: 24,
  planes: 3,
  phasing: 1,
  inclinationDeg: 53,
  altitudeKm: 700,
  pattern: 'delta',
};

export function ConstellationParamsForm(props: {
  value: ConstellationFormParams;
  onChange: (v: ConstellationFormParams) => void;
}): JSX.Element {
  const { value: v, onChange } = props;
  return (
    <Fields testId="constellation-params">
      <NumField label="Total sats (T)" value={v.totalSats} min={1} step={1} testId="param-const-total" onChange={(totalSats) => onChange({ ...v, totalSats })} />
      <NumField label="Planes (P)" value={v.planes} min={1} step={1} testId="param-const-planes" onChange={(planes) => onChange({ ...v, planes })} />
      <NumField label="Phasing (F)" value={v.phasing} min={0} step={1} testId="param-const-phasing" onChange={(phasing) => onChange({ ...v, phasing })} />
      <NumField label="Inclination (deg)" value={v.inclinationDeg} testId="param-const-inc" onChange={(inclinationDeg) => onChange({ ...v, inclinationDeg })} />
      <NumField label="Altitude (km)" value={v.altitudeKm} min={1} testId="param-const-alt" onChange={(altitudeKm) => onChange({ ...v, altitudeKm })} />
      <SelectField
        label="Pattern"
        value={v.pattern}
        testId="param-const-pattern"
        options={[
          { value: 'delta', label: 'Delta' },
          { value: 'star', label: 'Star' },
        ]}
        onChange={(pattern) => onChange({ ...v, pattern })}
      />
    </Fields>
  );
}

/** Eigen-axis slew parameters: from/to pointing references and the slew dynamics. */
export interface SlewFormParams {
  fromMode: 'nadir' | 'sun';
  toMode: 'nadir' | 'sun';
  maxRateDeg: number;
  maxAccelDeg: number;
}

export const DEFAULT_SLEW_PARAMS: SlewFormParams = { fromMode: 'nadir', toMode: 'sun', maxRateDeg: 2, maxAccelDeg: 0.5 };

const POINTING_OPTIONS = [
  { value: 'nadir', label: 'Nadir' },
  { value: 'sun', label: 'Sun' },
] as const;

export function SlewParamsForm(props: { value: SlewFormParams; onChange: (v: SlewFormParams) => void }): JSX.Element {
  const { value: v, onChange } = props;
  return (
    <Fields testId="slew-params">
      <SelectField label="From" value={v.fromMode} testId="param-slew-from" options={POINTING_OPTIONS} onChange={(fromMode) => onChange({ ...v, fromMode })} />
      <SelectField label="To" value={v.toMode} testId="param-slew-to" options={POINTING_OPTIONS} onChange={(toMode) => onChange({ ...v, toMode })} />
      <NumField label="Max rate (deg/s)" value={v.maxRateDeg} min={0.001} testId="param-slew-rate" onChange={(maxRateDeg) => onChange({ ...v, maxRateDeg })} />
      <NumField label="Max accel (deg/s2)" value={v.maxAccelDeg} min={0.001} testId="param-slew-accel" onChange={(maxAccelDeg) => onChange({ ...v, maxAccelDeg })} />
    </Fields>
  );
}
