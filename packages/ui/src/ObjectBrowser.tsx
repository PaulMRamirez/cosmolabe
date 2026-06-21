// Object browser: one row per catalog object. The row name toggles selection
// (multi-select, drives the inspector and measure), a crosshair centers the
// camera on it, and an eye toggles its visibility. Presentational; the viewer
// owns the selection set, focus, and visibility map and the scene wiring.

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
