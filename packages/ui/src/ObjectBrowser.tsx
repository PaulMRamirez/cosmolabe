// Object browser: one row per catalog object. The row name toggles selection
// (multi-select, drives the inspector and measure), a crosshair centers the
// camera on it, an eye toggles its visibility, and a spacecraft row gains a track
// toggle (the camera follows it). Presentational; the viewer owns the selection
// set, focus, visibility map, tracking, and the scene wiring.

import { Icon, DomainIcon } from '@bessel/selene-design';

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: 'body' | 'spacecraft' | 'instrument';
}

export interface ObjectBrowserProps {
  readonly entries: readonly CatalogEntry[];
  readonly selection: readonly string[];
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleVisible: (id: string, visible: boolean) => void;
  /** Current camera focus, marked with aria-current on its row. */
  readonly focus?: string;
  /** Center the camera on a body; when omitted the per-row crosshair is hidden. */
  readonly onCenter?: (id: string) => void;
  /** Toggle camera tracking of a spacecraft; when omitted the per-row track icon is
   *  hidden. Tracking is global to the mission spacecraft, so `tracking` is shared. */
  readonly onToggleTrack?: (id: string) => void;
  readonly tracking?: boolean;
  /** Instrument-layer controls, surfaced on instrument rows: the eye shows/hides that
   *  sensor's FOV + footprint (instruments have no mesh, so this is their real "show"),
   *  and the FOV/footprint sub-toggles appear when it is shown. Replaces the separate
   *  Show-instruments button and the instrument selector. */
  readonly instrumentLayer?: {
    readonly isShown: (id: string) => boolean;
    readonly onToggle: (id: string) => void;
    readonly fovOn: boolean;
    readonly footprintOn: boolean;
    readonly onToggleFov: () => void;
    readonly onToggleFootprint: () => void;
  };
}

/** A crosshair (center-on) glyph. */
function CenterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="6" />
      <line x1="12" y1="1" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="23" />
      <line x1="1" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="23" y2="12" />
    </svg>
  );
}

/** An eye glyph; a diagonal slash is added when the body is hidden. */
function EyeIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {open ? null : <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

/** The instrument-row controls: the eye toggles the sensor's FOV + footprint layer,
 *  and the FOV / footprint sub-toggles appear (and apply) only while it is shown. */
function InstrumentControls({
  name,
  id,
  layer,
}: {
  name: string;
  id: string;
  layer: NonNullable<ObjectBrowserProps['instrumentLayer']>;
}): JSX.Element {
  const shown = layer.isShown(id);
  return (
    <>
      {shown ? (
        <>
          <button
            type="button"
            className="bessel-body-layer"
            aria-pressed={layer.fovOn}
            aria-label={`${layer.fovOn ? 'Hide' : 'Show'} ${name} field of view`}
            title={`${layer.fovOn ? 'Hide' : 'Show'} field of view`}
            onClick={layer.onToggleFov}
            data-testid="toggle-fov"
          >
            <DomainIcon name="sensor-fov" size="sm" />
          </button>
          <button
            type="button"
            className="bessel-body-layer"
            aria-pressed={layer.footprintOn}
            aria-label={`${layer.footprintOn ? 'Hide' : 'Show'} ${name} footprint`}
            title={`${layer.footprintOn ? 'Hide' : 'Show'} footprint`}
            onClick={layer.onToggleFootprint}
            data-testid="toggle-footprint"
          >
            <DomainIcon name="sensor-footprint" size="sm" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        role="switch"
        className="bessel-eye"
        aria-checked={shown}
        aria-label={`${shown ? 'Hide' : 'Show'} ${name} sensor view`}
        title={`${shown ? 'Hide' : 'Show'} sensor view`}
        onClick={() => layer.onToggle(id)}
        data-testid={`instrument-show-${id}`}
      >
        <EyeIcon open={shown} />
      </button>
    </>
  );
}

export function ObjectBrowser(props: ObjectBrowserProps): JSX.Element {
  return (
    <section className="bessel-object-browser" aria-label="Object browser">
      <ul className="bessel-body-list">
        {props.entries.map((entry) => {
          const selected = props.selection.includes(entry.id);
          const visible = props.visibility[entry.id] ?? true;
          const focused = props.focus === entry.id;
          return (
            <li
              key={entry.id}
              className="bessel-body-row"
              data-kind={entry.kind}
              data-visible={visible}
            >
              <span className="bessel-body-dot" aria-hidden="true" />
              <button
                type="button"
                className="bessel-body-name"
                aria-pressed={selected}
                aria-current={focused ? 'true' : undefined}
                onClick={() => props.onToggleSelect(entry.id)}
                data-testid={`select-${entry.id}`}
              >
                {entry.name}
              </button>
              {entry.kind === 'instrument' && props.instrumentLayer ? (
                <InstrumentControls name={entry.name} id={entry.id} layer={props.instrumentLayer} />
              ) : (
                <>
                  {props.onToggleTrack && entry.kind === 'spacecraft' ? (
                    <button
                      type="button"
                      role="switch"
                      className="bessel-body-track"
                      aria-checked={!!props.tracking}
                      aria-label={`${props.tracking ? 'Stop tracking' : 'Track'} ${entry.name}`}
                      title={`${props.tracking ? 'Stop tracking' : 'Track'} ${entry.name}`}
                      onClick={() => props.onToggleTrack?.(entry.id)}
                      data-testid={`track-${entry.id}`}
                    >
                      <Icon name="radar" size="sm" />
                    </button>
                  ) : null}
                  {props.onCenter && entry.kind !== 'instrument' ? (
                    <button
                      type="button"
                      className="bessel-body-center"
                      aria-pressed={focused}
                      aria-label={`Fly to ${entry.name}`}
                      title={`Fly to ${entry.name}`}
                      onClick={() => props.onCenter?.(entry.id)}
                      data-testid={`center-${entry.id}`}
                    >
                      <CenterIcon />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="switch"
                    className="bessel-eye"
                    aria-checked={visible}
                    aria-label={`${visible ? 'Hide' : 'Show'} ${entry.name}`}
                    title={`${visible ? 'Hide' : 'Show'} ${entry.name}`}
                    onClick={() => props.onToggleVisible(entry.id, !visible)}
                    data-testid={`visible-${entry.id}`}
                  >
                    <EyeIcon open={visible} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {props.onCenter ? (
        <div className="bessel-body-legend" data-testid="object-browser-legend">
          <span className="bessel-body-legend-item">
            <span className="bessel-body-legend-swatch" aria-hidden="true">
              Aa
            </span>
            Bold name: selected (drives the inspector and measure)
          </span>
          <span className="bessel-body-legend-item">
            <span className="bessel-body-legend-glyph" aria-hidden="true">
              <CenterIcon />
            </span>
            Crosshair: fly the camera to that object
          </span>
        </div>
      ) : null}
    </section>
  );
}
