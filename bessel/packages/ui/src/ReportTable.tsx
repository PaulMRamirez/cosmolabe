// A compact report table for the analysis workbench: a header row of column labels
// (with units) and tabulated rows. Large reports are truncated for display with a
// count; the full data is exported via CSV elsewhere. Presentational. (STK §4.10.)

export interface ReportTableProps {
  /** Column header labels (e.g. "UTC", "range (km)"). */
  readonly columns: readonly string[];
  /** Rows of cells, aligned to `columns`. */
  readonly rows: readonly (readonly (string | number)[])[];
  /** Max rows to render (default 25); extra rows are summarized. */
  readonly maxRows?: number;
  /** Significant digits for numeric cells (default 6). */
  readonly precision?: number;
  readonly testId?: string;
}

/** Serialize a report to TSV at the given precision (for clipboard copy). Pure. */
export function reportToText(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
  precision = 6,
): string {
  const fmt = (v: string | number): string => (typeof v === 'number' ? v.toPrecision(precision) : v);
  const header = columns.join('\t');
  const body = rows.map((r) => r.map(fmt).join('\t')).join('\n');
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

export function ReportTable(props: ReportTableProps): JSX.Element {
  const maxRows = props.maxRows ?? 25;
  const prec = props.precision ?? 6;
  const shown = props.rows.slice(0, maxRows);
  const hidden = props.rows.length - shown.length;
  const cell = (v: string | number): string => (typeof v === 'number' ? v.toPrecision(prec) : v);
  return (
    <div className="bessel-report" data-testid={props.testId ?? 'report-table'}>
      <table className="bessel-report-table">
        <thead>
          <tr>
            {props.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => (
                <td key={c}>{cell(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bessel-report-meta" data-testid="report-row-count">
        {props.rows.length} row{props.rows.length === 1 ? '' : 's'}
        {hidden > 0 ? ` (showing first ${shown.length})` : ''}
      </div>
    </div>
  );
}
