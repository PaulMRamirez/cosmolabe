import { Button, Icon } from '@bessel/selene-design';
import { Tooltip } from './Tooltip.tsx';

// Camera reference-frame selector and the dolly/crane motion band. Selecting a frame
// engages 'frame' camera mode (the viewer auto-switches), so the picker is always
// operable rather than a dead control that needs Frame mode chosen first; it locks the
// camera basis to a chosen SPICE frame (any frame->J2000 rotation, e.g. IAU_EARTH or a
// mission frame), beyond the orbit/sync/track set. The dolly/crane band exposes the
// richer Cosmographia camera-motion verbs as click-and-hold buttons (also bound to keys
// R/F, T/G). Presentational: the viewer wires each callback to the engine.

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
  /** True when the 'frame' camera mode is active (drives the inline hint). */
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
        <span className="bessel-frame-hint" data-testid="camera-frame-hint">
          {props.frameMode ? 'Frame locked' : 'Picks Frame mode'}
        </span>
      </label>
      <div className="bessel-view-modes" role="group" aria-label="Camera motion">
        <Tooltip label="Dolly in: move the camera toward the focus along the view axis (R)">
          <Button
            iconOnly
            onClick={() => props.onDolly(STEP)}
            testId="camera-dolly-in"
            ariaLabel="Dolly in (R)"
            title="Dolly in: move the camera toward the focus along the view axis (R)"
          >
            <Icon name="zoom-in" />
          </Button>
        </Tooltip>
        <Tooltip label="Dolly out: move the camera away along the view axis (F)">
          <Button
            iconOnly
            onClick={() => props.onDolly(-STEP)}
            testId="camera-dolly-out"
            ariaLabel="Dolly out (F)"
            title="Dolly out: move the camera away along the view axis (F)"
          >
            <Icon name="zoom-out" />
          </Button>
        </Tooltip>
        <Tooltip label="Crane up: raise the viewpoint vertically (T)">
          <Button
            iconOnly
            onClick={() => props.onCrane(STEP)}
            testId="camera-crane-up"
            ariaLabel="Crane up (T)"
            title="Crane up: raise the viewpoint vertically (T)"
          >
            <Icon name="arrow-up" />
          </Button>
        </Tooltip>
        <Tooltip label="Crane down: lower the viewpoint vertically (G)">
          <Button
            iconOnly
            onClick={() => props.onCrane(-STEP)}
            testId="camera-crane-down"
            ariaLabel="Crane down (G)"
            title="Crane down: lower the viewpoint vertically (G)"
          >
            <Icon name="arrow-down" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
