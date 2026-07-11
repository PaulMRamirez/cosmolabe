// Object detail panel: shows the selected object's name and a list of labeled
// fields (kind, SPICE id, geometry readouts). Presentational; the viewer maps
// the current selection and readouts into fields.

export interface InspectorField {
  readonly label: string;
  readonly value: string;
}

export interface ObjectInspectorProps {
  readonly name: string | null;
  readonly kind?: string;
  readonly fields: readonly InspectorField[];
  readonly emptyMessage?: string;
}

export function ObjectInspector(props: ObjectInspectorProps): JSX.Element {
  if (!props.name) {
    return (
      <div className="bessel-inspector" data-testid="object-inspector">
        <p className="bessel-inspector-empty">{props.emptyMessage ?? 'No object selected'}</p>
      </div>
    );
  }
  return (
    <div className="bessel-inspector" data-testid="object-inspector">
      <header className="bessel-inspector-head">
        <span className="bessel-inspector-name" data-testid="inspector-name">
          {props.name}
        </span>
        {props.kind ? <span className="bessel-inspector-kind">{props.kind}</span> : null}
      </header>
      <dl className="bessel-inspector-fields">
        {props.fields.map((field) => (
          <div key={field.label} className="bessel-inspector-row">
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
