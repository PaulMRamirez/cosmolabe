// Camera target controls (Phase 0): center the view on a body. Phase 1 adds the
// object browser, visualization settings, and the full keyboard shortcut set.

export interface ViewControlsProps {
  readonly bodies: readonly string[];
  readonly focus: string;
  readonly onCenter: (body: string) => void;
  /** Set the view looking from the Sun toward the focus (vector-set-view). */
  readonly onViewFromSun?: () => void;
  /** Set the view looking down the spacecraft velocity, if any. */
  readonly onViewAlongVelocity?: () => void;
  /** Set a top-down view looking onto the ecliptic plane. */
  readonly onViewTopDown?: () => void;
}

export function ViewControls(props: ViewControlsProps): JSX.Element {
  return (
    <div className="bessel-viewcontrols" role="group" aria-label="Camera targets">
      <span>Center on:</span>
      {props.bodies.map((body) => (
        <button
          key={body}
          type="button"
          onClick={() => props.onCenter(body)}
          aria-pressed={props.focus === body}
          data-testid={`center-${body}`}
        >
          {body}
        </button>
      ))}
      {props.onViewTopDown ? (
        <button
          type="button"
          onClick={props.onViewTopDown}
          data-testid="view-top-down"
          title="Look straight down onto the ecliptic plane"
        >
          Top down
        </button>
      ) : null}
      {props.onViewFromSun ? (
        <button
          type="button"
          onClick={props.onViewFromSun}
          data-testid="view-from-sun"
          title="Look from the Sun toward the focus"
        >
          Sun view
        </button>
      ) : null}
      {props.onViewAlongVelocity ? (
        <button
          type="button"
          onClick={props.onViewAlongVelocity}
          data-testid="view-along-velocity"
          title="Look down the spacecraft velocity"
        >
          Velocity view
        </button>
      ) : null}
    </div>
  );
}
