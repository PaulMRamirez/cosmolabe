// The compare tray: kept analysis snapshots tabulated side by side, grouped by tool
// (same-tool comparison), so an analyst can weigh trade cases. Presentational: it reads
// the keptSnapshots slice and calls the engine to remove/clear/export. Lives in the
// lazy Compare tab of the Analyze dock; reuses ReportTable for the metric grid.

import { Button } from '@bessel/selene-design';
import { ReportTable, downloadBlob } from '@bessel/ui';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore, type KeptSnapshot } from '../store/index.ts';

export interface CompareTrayProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

/** Serialize kept snapshots to CSV, one section per tool. */
function toCsv(snapshots: readonly KeptSnapshot[]): string {
  const tools = [...new Set(snapshots.map((s) => s.tool))];
  return (
    tools
      .map((tool) => {
        const group = snapshots.filter((s) => s.tool === tool);
        const labels = group[0]?.metrics.map((m) => m.label) ?? [];
        const head = ['metric', ...group.map((s) => s.name)].join(',');
        const rows = labels.map((l) =>
          [l, ...group.map((s) => s.metrics.find((m) => m.label === l)?.value ?? '')].join(','),
        );
        return [`tool: ${tool}`, head, ...rows].join('\n');
      })
      .join('\n\n') + '\n'
  );
}

export function CompareTray(props: CompareTrayProps): JSX.Element {
  const { engine, store } = props;
  const snapshots = useStore(store, (s) => s.keptSnapshots);

  if (snapshots.length === 0) {
    return (
      <p className="bessel-loader-hint" data-testid="compare-empty">
        Keep an access, conjunction, or link result to compare trade cases here.
      </p>
    );
  }

  const tools = [...new Set(snapshots.map((s) => s.tool))];
  return (
    <div className="bessel-compare-tray" data-testid="compare-tray">
      <div className="bessel-compare-tools">
        <Button
          variant="secondary"
          testId="compare-csv"
          onClick={() => downloadBlob(new Blob([toCsv(snapshots)], { type: 'text/csv' }), 'compare.csv')}
        >
          Export CSV
        </Button>
        <Button variant="ghost" testId="compare-clear" onClick={() => engine?.clearSnapshots()}>
          Clear
        </Button>
      </div>
      {tools.map((tool) => {
        const group = snapshots.filter((s) => s.tool === tool);
        const labels = group[0]?.metrics.map((m) => m.label) ?? [];
        return (
          <div key={tool}>
            <div className="bessel-compare-chips">
              {group.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="bessel-snapshot-remove"
                  aria-label={`Remove ${s.name}`}
                  data-testid={`snapshot-remove-${s.id}`}
                  onClick={() => engine?.removeSnapshot(s.id)}
                >
                  {s.name} <span aria-hidden="true">✕</span>
                </button>
              ))}
            </div>
            <ReportTable
              testId="compare-table"
              columns={[tool, ...group.map((s) => s.name)]}
              rows={labels.map((l) => [l, ...group.map((s) => s.metrics.find((m) => m.label === l)?.value ?? '-')])}
            />
          </div>
        );
      })}
    </div>
  );
}
