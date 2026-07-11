// State panel: the focused body's position and velocity vectors plus its
// osculating elements at the current epoch, in a selectable SPICE frame.
// Presentational: the engine computes the BodyState (spkezr + oscelt) and the
// viewer passes it through; n/a until a state is available.

import { Button } from '@bessel/selene-design';

/** The focused body's Cartesian state and osculating elements, frame-relative. */
export interface BodyState {
  /** The body the state describes. */
  readonly target: string;
  /** The central body the elements orbit (the osculating focus). */
  readonly center: string;
  /** Position vector (km) in the selected frame. */
  readonly r: readonly [number, number, number];
  /** Velocity vector (km/s) in the selected frame. */
  readonly v: readonly [number, number, number];
  /** Semi-major axis (km); not finite for parabolic/hyperbolic. */
  readonly semiMajorKm: number;
  /** Eccentricity. */
  readonly ecc: number;
  /** Inclination (degrees). */
  readonly incDeg: number;
  /** Right ascension of the ascending node (degrees). */
  readonly raanDeg: number;
  /** Argument of periapsis (degrees). */
  readonly argpDeg: number;
  /** True anomaly (degrees). */
  readonly trueAnomalyDeg: number;
}

/** Frames offered for the state readout; any string the kernels resolve is valid. */
export const STATE_FRAMES: readonly string[] = ['J2000', 'ECLIPJ2000', 'IAU_EARTH', 'IAU_SUN'];

export interface StateVectorPanelProps {
  readonly target: string;
  readonly state: BodyState | null;
  readonly frame: string;
  readonly onFrameChange: (frame: string) => void;
}

function vec(v: readonly [number, number, number], unit: string): string {
  return `[${v.map((c) => c.toFixed(3)).join(', ')}] ${unit}`;
}

function km(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return `${Math.round(value).toLocaleString('en-US')} km`;
}

function deg(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(2)} deg`;
}

function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(5) : 'n/a';
}

/** A copyable plain-text rendering of the state, for pasting into notes or tools. */
function stateToText(s: BodyState, frame: string): string {
  return [
    `${s.target} state (center ${s.center}, frame ${frame})`,
    `r ${vec(s.r, 'km')}`,
    `v ${vec(s.v, 'km/s')}`,
    `a ${km(s.semiMajorKm)}  e ${num(s.ecc)}  i ${deg(s.incDeg)}`,
    `RAAN ${deg(s.raanDeg)}  argp ${deg(s.argpDeg)}  nu ${deg(s.trueAnomalyDeg)}`,
  ].join('\n');
}

export function StateVectorPanel(props: StateVectorPanelProps): JSX.Element {
  const { state, frame } = props;
  return (
    <section className="bessel-statevec" aria-label={`State vectors for ${props.target}`}>
      <div className="bessel-statevec-head">
        <h2 className="bessel-panel-title">State: {props.target}</h2>
        <label className="bessel-statevec-frame">
          <span className="bessel-visually-hidden">Reference frame</span>
          <select
            value={frame}
            onChange={(e) => props.onFrameChange(e.target.value)}
            data-testid="state-frame-select"
            aria-label="State reference frame"
          >
            {(STATE_FRAMES.includes(frame) ? STATE_FRAMES : [frame, ...STATE_FRAMES]).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state === null ? (
        <p className="bessel-statevec-empty" data-testid="state-empty">
          n/a: no state for this body at this epoch.
        </p>
      ) : (
        <>
          <dl>
            <dt>Position</dt>
            <dd data-testid="state-r">{vec(state.r, 'km')}</dd>
            <dt>Velocity</dt>
            <dd data-testid="state-v">{vec(state.v, 'km/s')}</dd>
            <dt>Semi-major</dt>
            <dd data-testid="state-a">{km(state.semiMajorKm)}</dd>
            <dt>Eccentricity</dt>
            <dd data-testid="state-ecc">{num(state.ecc)}</dd>
            <dt>Inclination</dt>
            <dd data-testid="state-inc">{deg(state.incDeg)}</dd>
            <dt>RAAN</dt>
            <dd data-testid="state-raan">{deg(state.raanDeg)}</dd>
            <dt>Arg of periapsis</dt>
            <dd data-testid="state-argp">{deg(state.argpDeg)}</dd>
            <dt>True anomaly</dt>
            <dd data-testid="state-nu">{deg(state.trueAnomalyDeg)}</dd>
          </dl>
          <Button
            variant="ghost"
            testId="state-copy"
            onClick={() => void navigator.clipboard?.writeText(stateToText(state, frame))}
          >
            Copy
          </Button>
        </>
      )}
    </section>
  );
}
