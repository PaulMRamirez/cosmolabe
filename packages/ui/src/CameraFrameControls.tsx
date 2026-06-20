// Camera reference-frame selector and the dolly/crane motion band. When the
// camera is in 'frame' mode it locks its basis to a chosen SPICE frame (any
// frame->J2000 rotation, e.g. IAU_EARTH or a mission frame), beyond the
// orbit/sync/track set. The dolly/crane band exposes the richer Cosmographia
// camera-motion verbs as click-and-hold buttons (also bound to keys R/F, T/G).
// Presentational: the viewer wires each callback to the engine.

/** A handful of common SPICE frames offered in the picker; any string is valid. */
export const COMMON_SPICE_FRAMES: readonly string[] = [
  'J2000',
  'IAU_EARTH',
  'IAU_MOON',
  'IAU_MARS',
  'IAU_SUN',
  'ECLIPJ2000',
];

export interface CameraFrameControlsProps {
  /** The currently selected SPICE frame name (shown when frame mode is active). */
  readonly frame: string;
  /** True when the 'frame' camera mode is active (enables the selector). */
  readonly frameMode: boolean;
  readonly onFrame: (frame: string) => void;
  /** Dolly the camera along its view axis: forward > 0 approaches the focus. */
  readonly onDolly: (forward: number) => void;
  /** Crane the camera vertically: up > 0 raises the viewpoint. */
  readonly onCrane: (up: number) => void;
}

const STEP = 0.12;

export function CameraFrameControls(props: CameraFrameControlsProps): JSX.Element {
  return (
    <div className="bessel-camera-frame" role="group" aria-label="Camera frame and motion">
      <label className="bessel-frame-select">
        <span>Lock frame</span>
        <select
          value={props.frame}
          disabled={!props.frameMode}
          onChange={(e) => props.onFrame(e.target.value)}
          data-testid="camera-frame-select"
          aria-label="SPICE reference frame"
        >
          {(COMMON_SPICE_FRAMES.includes(props.frame)
            ? COMMON_SPICE_FRAMES
            : [props.frame, ...COMMON_SPICE_FRAMES]
          ).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <div className="bessel-view-modes" role="group" aria-label="Camera motion">
        <button
          type="button"
          onClick={() => props.onDolly(STEP)}
          data-testid="camera-dolly-in"
          title="Dolly in: move the camera toward the focus along the view axis (R)"
        >
          Dolly in
        </button>
        <button
          type="button"
          onClick={() => props.onDolly(-STEP)}
          data-testid="camera-dolly-out"
          title="Dolly out: move the camera away along the view axis (F)"
        >
          Dolly out
        </button>
        <button
          type="button"
          onClick={() => props.onCrane(STEP)}
          data-testid="camera-crane-up"
          title="Crane up: raise the viewpoint vertically (T)"
        >
          Crane up
        </button>
        <button
          type="button"
          onClick={() => props.onCrane(-STEP)}
          data-testid="camera-crane-down"
          title="Crane down: lower the viewpoint vertically (G)"
        >
          Crane down
        </button>
      </div>
    </div>
  );
}
