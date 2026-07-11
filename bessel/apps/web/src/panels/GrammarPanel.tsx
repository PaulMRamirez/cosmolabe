// The M-0008 grammar demo tab: the four product kinds of the compute plane
// (ADR M-0004) rendered in their four canonical forms, live from JobHandle
// jobs with streamed partials. One card per kind: access intervals draw onto
// timeline lanes as targets complete (GS-2), the range series materializes
// chunk by chunk in a strip chart (GS-2), the ground track drapes into the
// scene (GS-2), and the Walker coverage field resolves cell by cell on the
// globe (GS-4). Every card carries the job tray chip (name, progress ring,
// cancel) and a 'Computed here' legend chip whose popover shows the product's
// real provenance block. Presentational: all compute runs through
// BesselEngine.runGrammarJob.

import { Tag, Metric } from '@bessel/selene-design';
import { IntervalTimeline, ProgressRing, TimeSeriesChart } from '@bessel/ui';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import type { GrammarJobKind, GrammarJobView } from '../store/app-state.ts';
import { Action } from './analysis-shared.tsx';

export interface GrammarPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

const JOBS: readonly { kind: GrammarJobKind; title: string; form: string; scenario: string }[] = [
  { kind: 'gs2-access', title: 'Access windows', form: 'timeline lanes', scenario: 'GS-2' },
  { kind: 'gs2-series', title: 'Range series', form: 'strip chart', scenario: 'GS-2' },
  { kind: 'gs2-track', title: 'Ground track', form: 'in-scene drape', scenario: 'GS-2' },
  { kind: 'gs4-field', title: 'Walker coverage field', form: 'heatmap drape', scenario: 'GS-4' },
  { kind: 'gs4-access', title: 'Walker site passes', form: 'timeline lanes', scenario: 'GS-4' },
];

/** Timeline lanes for one access card, from the keyed intervals view. */
function LaneStack({
  kind,
  intervals,
}: {
  readonly kind: GrammarJobKind;
  readonly intervals: Partial<Readonly<Record<GrammarJobKind, { sets: readonly { label: string; intervals: readonly (readonly [number, number])[] }[]; span: readonly [number, number] }>>>;
}): JSX.Element | null {
  const view = intervals[kind];
  if (!view) return null;
  return (
    <div data-testid={`grammar-lanes-${kind}`}>
      {view.sets.map((set) => (
        <IntervalTimeline
          key={set.label}
          label={set.label}
          intervals={set.intervals.map(([a, b]) => [a, b] as [number, number])}
          span={[view.span[0], view.span[1]]}
          testId={`grammar-lane-${set.label}`}
        />
      ))}
    </div>
  );
}

function statusTone(status: GrammarJobView['status']): 'neutral' | 'cyan' | 'green' | 'amber' | 'red' {
  if (status === 'running') return 'cyan';
  if (status === 'done') return 'green';
  if (status === 'cancelled') return 'amber';
  if (typeof status === 'object') return 'red';
  return 'neutral';
}

function statusLabel(status: GrammarJobView['status']): string {
  return typeof status === 'object' ? 'error' : status;
}

/** The provenance legend chip: 'Computed here' plus the popover with the
 *  product's provenance block, straight from AnalysisProduct.provenance. */
function ProvenanceChip({ job }: { readonly job: GrammarJobView }): JSX.Element | null {
  const p = job.provenance;
  if (!p) return null;
  return (
    <details data-testid="grammar-provenance">
      <summary>
        <Tag tone="cyan">Computed here</Tag>
      </summary>
      <div style={{ display: 'grid', gap: 4, padding: '6px 0' }}>
        <Metric label="engine" value={`${p.engine}@${p.version}`} />
        <Metric label="kernel set" value={p.setHash.slice(0, 16)} />
        <Metric label="frame" value={p.frame} />
        <Metric label="correction" value={p.correction} />
        <Metric label="computed" value={p.computedAt} />
        <Metric label="job" value={p.jobId} />
      </div>
    </details>
  );
}

function JobCard({
  engine,
  store,
  kind,
  title,
  form,
  scenario,
  children,
}: {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly kind: GrammarJobKind;
  readonly title: string;
  readonly form: string;
  readonly scenario: string;
  readonly children?: React.ReactNode;
}): JSX.Element {
  const job = useStore(store, (s) => s.grammar.jobs[kind]);
  const running = job.status === 'running';
  return (
    <section
      data-testid={`grammar-card-${kind}`}
      data-status={statusLabel(job.status)}
      data-partials={job.partials}
      style={{ border: '1px solid #3335', borderRadius: 6, padding: 10, marginBottom: 10 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ProgressRing pct={job.pct} active={running} />
        <strong style={{ flex: 1 }}>
          {title} <Tag tone="neutral">{scenario}</Tag> <Tag tone="violet">{form}</Tag>
        </strong>
        <Tag tone={statusTone(job.status)}>{statusLabel(job.status)}</Tag>
        {running ? (
          <Action onClick={() => engine?.cancelGrammarJob(kind)} testId={`grammar-cancel-${kind}`}>
            Cancel
          </Action>
        ) : (
          <Action onClick={() => void engine?.runGrammarJob(kind)} testId={`grammar-run-${kind}`}>
            Run
          </Action>
        )}
      </header>
      {typeof job.status === 'object' && (
        <p style={{ color: '#f47067' }}>{job.status.error}</p>
      )}
      <ProvenanceChip job={job} />
      {children}
    </section>
  );
}

export function GrammarPanel({ engine, store }: GrammarPanelProps): JSX.Element {
  const grammar = useStore(store, (s) => s.grammar);
  return (
    <div data-testid="grammar-panel">
      <p>
        The four product kinds of the compute plane, live from streamed JobHandle partials
        (M-0004, M-0008). Kernel set{' '}
        <code data-testid="grammar-kernel-hash">
          {grammar.kernelSetHash ? grammar.kernelSetHash.slice(0, 16) : 'loads on first run'}
        </code>
        .
      </p>

      <JobCard engine={engine} store={store} {...JOBS[0]!}>
        <LaneStack kind="gs2-access" intervals={grammar.intervals} />
      </JobCard>

      <JobCard engine={engine} store={store} {...JOBS[1]!}>
        {grammar.series && (
          <TimeSeriesChart
            et={Array.from(grammar.series.et)}
            value={Array.from(grammar.series.values)}
            label={`${grammar.series.name} (${grammar.series.unit})`}
            testId="grammar-series-chart"
          />
        )}
      </JobCard>

      <JobCard engine={engine} store={store} {...JOBS[2]!}>
        {grammar.trackPoints > 0 && (
          <p data-testid="grammar-track-note">
            <Tag tone="green">draped</Tag> {grammar.trackPoints} vertices on Saturn (snapshot at
            the demo epoch).
          </p>
        )}
      </JobCard>

      <JobCard engine={engine} store={store} {...JOBS[3]!}>
        {grammar.fieldCellsTotal > 0 && (
          <p data-testid="grammar-field-note">
            <Tag tone="green">draped</Tag> {grammar.fieldCellsResolved} of {grammar.fieldCellsTotal}{' '}
            cells resolved on Earth.
          </p>
        )}
      </JobCard>

      <JobCard engine={engine} store={store} {...JOBS[4]!}>
        <LaneStack kind="gs4-access" intervals={grammar.intervals} />
      </JobCard>
    </div>
  );
}
