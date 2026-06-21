// The per-tool parameter forms for the analysis workbench, extracted from AnalysisPanel
// so the panel stays near its soft cap. Each form is a controlled component over a plain
// param object (value + onChange-merge); the panel owns the state and passes the assembled
// object to the matching engine method. Presentational: no engine or store access.

import type { ReactNode } from 'react';
import {
  DEFAULT_LINK,
  DEFAULT_CONJUNCTION,
  DEFAULT_CONSTELLATION,
  DEFAULT_SLEW,
  type ConstellationParams,
} from '../engine/analysis-defaults.ts';

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
          // Ignore a non-finite parse (empty or partial input like '', '-', '1e') so NaN
          // never reaches the engine; the field keeps its last good value.
          const n = Number(ev.target.value);
          if (!Number.isFinite(n)) return;
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

/** A field descriptor: a number input or a select over fixed options, bound to a key of T. */
type FieldDesc<T> =
  | { kind: 'num'; key: keyof T; label: string; testId: string; min?: number; step?: number }
  | {
      kind: 'select';
      key: keyof T;
      label: string;
      testId: string;
      options: readonly { readonly value: string; readonly label: string }[];
    };

/** Render a controlled form from a field-descriptor list, merging each change into the
 *  param object. One renderer drives every tool's form, so adding a field is a data edit. */
function ParamForm<T extends object>(props: {
  value: T;
  onChange: (v: T) => void;
  fields: readonly FieldDesc<T>[];
  testId: string;
}): JSX.Element {
  const set = (key: keyof T, v: number | string): void => props.onChange({ ...props.value, [key]: v } as T);
  return (
    <Fields testId={props.testId}>
      {props.fields.map((f) =>
        f.kind === 'num' ? (
          <NumField
            key={f.testId}
            label={f.label}
            testId={f.testId}
            min={f.min}
            step={f.step}
            value={props.value[f.key] as number}
            onChange={(n) => set(f.key, n)}
          />
        ) : (
          <SelectField
            key={f.testId}
            label={f.label}
            testId={f.testId}
            value={props.value[f.key] as string}
            options={f.options}
            onChange={(s) => set(f.key, s)}
          />
        ),
      )}
    </Fields>
  );
}

/** Downlink radio parameters (UI units: GHz). Converted to Hz at the call site. */
export interface LinkParams {
  eirpDbW: number;
  freqGHz: number;
  gOverTDbK: number;
  dataRateBps: number;
}

export const DEFAULT_LINK_PARAMS: LinkParams = {
  eirpDbW: DEFAULT_LINK.eirpDbW,
  freqGHz: DEFAULT_LINK.freqHz / 1e9,
  gOverTDbK: DEFAULT_LINK.gOverTDbK,
  dataRateBps: DEFAULT_LINK.dataRateBps,
};

const LINK_FIELDS: readonly FieldDesc<LinkParams>[] = [
  { kind: 'num', key: 'eirpDbW', label: 'EIRP (dBW)', testId: 'param-link-eirp' },
  { kind: 'num', key: 'freqGHz', label: 'Freq (GHz)', testId: 'param-link-freq', min: 0.001 },
  { kind: 'num', key: 'gOverTDbK', label: 'G/T (dB/K)', testId: 'param-link-gt' },
  { kind: 'num', key: 'dataRateBps', label: 'Data rate (bps)', testId: 'param-link-rate', min: 1 },
];

export function LinkParamsForm(props: { value: LinkParams; onChange: (v: LinkParams) => void }): JSX.Element {
  return <ParamForm value={props.value} onChange={props.onChange} fields={LINK_FIELDS} testId="link-params" />;
}

/** Conjunction encounter covariance (per-axis sigma, combined hard-body radius), in km. */
export interface ConjunctionParams {
  sigmaKm: number;
  radiusKm: number;
}

export const DEFAULT_CONJUNCTION_PARAMS: ConjunctionParams = { ...DEFAULT_CONJUNCTION };

const CONJUNCTION_FIELDS: readonly FieldDesc<ConjunctionParams>[] = [
  { kind: 'num', key: 'sigmaKm', label: 'Sigma (km)', testId: 'param-conj-sigma', min: 0.0001 },
  { kind: 'num', key: 'radiusKm', label: 'Hard-body R (km)', testId: 'param-conj-radius', min: 0.0001 },
];

export function ConjunctionParamsForm(props: {
  value: ConjunctionParams;
  onChange: (v: ConjunctionParams) => void;
}): JSX.Element {
  return <ParamForm value={props.value} onChange={props.onChange} fields={CONJUNCTION_FIELDS} testId="conjunction-params" />;
}

/**
 * Whether a Walker T/P pair is buildable: T and P positive integers with T an exact
 * multiple of P. walkerConstellation throws otherwise, so the panel gates the run on this.
 */
export function isValidWalker(totalSats: number, planes: number): boolean {
  return (
    Number.isInteger(totalSats) &&
    Number.isInteger(planes) &&
    totalSats > 0 &&
    planes > 0 &&
    totalSats % planes === 0
  );
}

/** Walker constellation parameters (T/P/F, inclination deg, altitude km, pattern); the
 *  same shape the engine op consumes. */
export type ConstellationFormParams = ConstellationParams;

export const DEFAULT_CONSTELLATION_PARAMS: ConstellationFormParams = DEFAULT_CONSTELLATION;

const PATTERN_OPTIONS = [
  { value: 'delta', label: 'Delta' },
  { value: 'star', label: 'Star' },
] as const;

const CONSTELLATION_FIELDS: readonly FieldDesc<ConstellationFormParams>[] = [
  { kind: 'num', key: 'totalSats', label: 'Total sats (T)', testId: 'param-const-total', min: 1, step: 1 },
  { kind: 'num', key: 'planes', label: 'Planes (P)', testId: 'param-const-planes', min: 1, step: 1 },
  { kind: 'num', key: 'phasing', label: 'Phasing (F)', testId: 'param-const-phasing', min: 0, step: 1 },
  { kind: 'num', key: 'inclinationDeg', label: 'Inclination (deg)', testId: 'param-const-inc' },
  { kind: 'num', key: 'altitudeKm', label: 'Altitude (km)', testId: 'param-const-alt', min: 1 },
  { kind: 'select', key: 'pattern', label: 'Pattern', testId: 'param-const-pattern', options: PATTERN_OPTIONS },
];

export function ConstellationParamsForm(props: {
  value: ConstellationFormParams;
  onChange: (v: ConstellationFormParams) => void;
}): JSX.Element {
  return <ParamForm value={props.value} onChange={props.onChange} fields={CONSTELLATION_FIELDS} testId="constellation-params" />;
}

/** Eigen-axis slew parameters: from/to pointing references and the slew dynamics. */
export interface SlewFormParams {
  fromMode: 'nadir' | 'sun';
  toMode: 'nadir' | 'sun';
  maxRateDeg: number;
  maxAccelDeg: number;
}

export const DEFAULT_SLEW_PARAMS: SlewFormParams = { ...DEFAULT_SLEW };

const POINTING_OPTIONS = [
  { value: 'nadir', label: 'Nadir' },
  { value: 'sun', label: 'Sun' },
] as const;

const SLEW_FIELDS: readonly FieldDesc<SlewFormParams>[] = [
  { kind: 'select', key: 'fromMode', label: 'From', testId: 'param-slew-from', options: POINTING_OPTIONS },
  { kind: 'select', key: 'toMode', label: 'To', testId: 'param-slew-to', options: POINTING_OPTIONS },
  { kind: 'num', key: 'maxRateDeg', label: 'Max rate (deg/s)', testId: 'param-slew-rate', min: 0.001 },
  { kind: 'num', key: 'maxAccelDeg', label: 'Max accel (deg/s2)', testId: 'param-slew-accel', min: 0.001 },
];

export function SlewParamsForm(props: { value: SlewFormParams; onChange: (v: SlewFormParams) => void }): JSX.Element {
  return <ParamForm value={props.value} onChange={props.onChange} fields={SLEW_FIELDS} testId="slew-params" />;
}
