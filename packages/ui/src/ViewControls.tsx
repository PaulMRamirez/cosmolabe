// Camera view presets: a compact segmented control for the three global camera
// modes (top-down on the ecliptic, looking from the Sun, and down the spacecraft
// velocity). Per-body "center on" lives on each object row in the browser, so
// this is just the mode band. Velocity is disabled until a spacecraft is loaded.

export type CameraBaseMode = 'orbit' | 'sync' | 'free' | 'frame';

export interface ViewControlsProps {
  /** Set the view looking from the Sun toward the focus (vector-set-view). */
  readonly onViewFromSun?: () => void;
  /** Set the view looking down the spacecraft velocity, if any. */
  readonly onViewAlongVelocity?: () => void;
  /** Set a top-down view looking onto the ecliptic plane. */
  readonly onViewTopDown?: () => void;
  /** Current base camera mode (orbit / sync-orbit / free-fly). */
  readonly mode?: CameraBaseMode;
  readonly onMode?: (mode: CameraBaseMode) => void;
}

const MODES: readonly { id: CameraBaseMode; label: string; title: string }[] = [
  { id: 'orbit', label: 'Orbit', title: 'Orbit around the focused body' },
  { id: 'sync', label: 'Sync', title: 'Lock to the body and hover a fixed surface point' },
  { id: 'free', label: 'Free', title: 'Free fly: WASD to move, Q/E up-down, drag to look' },
  { id: 'frame', label: 'Frame', title: 'Lock the camera basis to a chosen SPICE frame' },
];

export function ViewControls(props: ViewControlsProps): JSX.Element {
  return (
    <>
      <div className="bessel-view-modes" role="group" aria-label="Camera views">
        <button
          type="button"
          onClick={props.onViewTopDown}
          disabled={!props.onViewTopDown}
          data-testid="view-top-down"
          title="Look straight down onto the ecliptic plane"
        >
          Top
        </button>
        <button
          type="button"
          onClick={props.onViewFromSun}
          disabled={!props.onViewFromSun}
          data-testid="view-from-sun"
          title="Look from the Sun toward the focus"
        >
          Sun
        </button>
        <button
          type="button"
          onClick={props.onViewAlongVelocity}
          disabled={!props.onViewAlongVelocity}
          data-testid="view-along-velocity"
          title="Look down the spacecraft velocity"
        >
          Velocity
        </button>
      </div>
      {props.onMode ? (
        <div className="bessel-view-modes" role="group" aria-label="Camera mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => props.onMode?.(m.id)}
              aria-pressed={props.mode === m.id}
              data-testid={`camera-mode-${m.id}`}
              title={m.title}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
