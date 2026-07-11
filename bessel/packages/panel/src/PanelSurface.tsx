// The panel surface: host-supplied products and fallback-computed jobs, each
// rendered in its kind's canonical panel form (lanes, strip chart, 2D ground
// track, flat heatmap) with the provenance legend chip and the job tray chip
// (progress ring, cancel). Fallback compute builds one substrate client from
// the adapter and runs the adapter's jobs sequentially so materialization is
// deterministic; the effect cleanup disposes the client, so unmounting the
// panel tears the worker down.

import { useEffect, useMemo, useState } from 'react';
import { Metric, Tag } from '@bessel/selene-design';
import { GroundTrackMap, IntervalTimeline, ProgressRing, TimeSeriesChart } from '@bessel/ui';
import {
  JobClient,
  JobClientCancelled,
  type AnalysisProduct,
  type Provenance,
} from '@bessel/compute';
import type { HostDataAdapter, PanelJob } from './index.ts';
import { fieldToCells, layerToLonLat } from './mappers.ts';

interface JobState {
  readonly label: string;
  readonly status: 'queued' | 'running' | 'done' | 'cancelled' | { readonly error: string };
  readonly pct: number;
  readonly partials: number;
  readonly product: AnalysisProduct | null;
  readonly cancel: (() => void) | null;
}

export function ProvenanceChip({ provenance }: { readonly provenance: Provenance }): JSX.Element {
  return (
    <details data-testid="panel-provenance">
      <summary>
        <Tag tone={provenance.authority === 'host' ? 'neutral' : 'cyan'}>
          {provenance.authority === 'host' ? 'Host data' : 'Computed here'}
        </Tag>
      </summary>
      <div style={{ display: 'grid', gap: 4, padding: '6px 0' }}>
        <Metric label="engine" value={`${provenance.engine}@${provenance.version}`} />
        <Metric label="kernel set" value={provenance.kernels.setHash.slice(0, 16)} />
        <Metric label="frame" value={provenance.frame} />
        <Metric label="correction" value={provenance.correction} />
        <Metric label="computed" value={provenance.computedAt} />
        <Metric label="job" value={provenance.jobId} />
      </div>
    </details>
  );
}

/** A flat heatmap for the field kind: one rect per cell, unresolved dim. */
function FieldMap({ product }: { readonly product: AnalysisProduct }): JSX.Element | null {
  if (product.product.kind !== 'field') return null;
  const field = product.product.field;
  const cells = fieldToCells(field);
  const w = 280;
  const h = 140;
  const cw = w / field.lonCount;
  const ch = h / field.latCount;
  return (
    <svg width={w} height={h} role="img" aria-label={`${field.name} field`} data-testid="panel-field-map">
      {cells.map((cell) => {
        const t = cell.value === null ? 0 : Math.min(1, Math.max(0, cell.value / 100));
        const fill =
          cell.value === null ? '#8883' : `hsl(${210 - 170 * t} 80% ${25 + 35 * t}%)`;
        return (
          <rect
            key={`${cell.row}-${cell.col}`}
            x={cell.col * cw}
            y={h - (cell.row + 1) * ch}
            width={cw}
            height={ch}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

export function ProductView({ product }: { readonly product: AnalysisProduct }): JSX.Element | null {
  const p = product.product;
  if (p.kind === 'intervals') {
    const spans = p.sets.flatMap((s) => s.intervals.flat());
    const span: [number, number] =
      spans.length > 0 ? [Math.min(...spans), Math.max(...spans)] : [0, 1];
    return (
      <div data-testid="panel-lanes">
        {p.sets.map((set) => (
          <IntervalTimeline
            key={set.label}
            label={set.label}
            intervals={set.intervals.map(([a, b]) => [a, b] as [number, number])}
            span={span}
            testId={`panel-lane-${set.label}`}
          />
        ))}
      </div>
    );
  }
  if (p.kind === 'series') {
    return (
      <div data-testid="panel-series">
        {p.series.map((s) => (
          <TimeSeriesChart
            key={s.name}
            et={Array.from(s.et)}
            value={Array.from(s.values)}
            label={`${s.name} (${s.unit})`}
            testId={`panel-chart-${s.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '')}`}
          />
        ))}
      </div>
    );
  }
  if (p.kind === 'geometry') {
    const layer = p.layers[0];
    if (!layer) return null;
    const { lon, lat } = layerToLonLat(layer);
    return (
      <div data-testid="panel-track">
        <GroundTrackMap lon={lon} lat={lat} />
      </div>
    );
  }
  return <FieldMap product={product} />;
}

export function PanelSurface({ data }: { readonly data: HostDataAdapter }): JSX.Element {
  const [hostProducts, setHostProducts] = useState<readonly AnalysisProduct[]>([]);
  const [jobs, setJobs] = useState<readonly JobState[]>([]);
  const [fault, setFault] = useState<string | null>(null);
  const jobDefs = useMemo<readonly PanelJob[]>(() => data.compute?.jobs ?? [], [data]);

  useEffect(() => {
    let disposed = false;
    let client: JobClient | null = null;
    const patch = (i: number, p: Partial<JobState>): void => {
      setJobs((prev) => prev.map((j, k) => (k === i ? { ...j, ...p } : j)));
    };

    void (async () => {
      try {
        if (data.products) setHostProducts(await data.products());
        const compute = data.compute;
        if (!compute) return;
        setJobs(
          compute.jobs.map((j) => ({
            label: j.label,
            status: 'queued',
            pct: 0,
            partials: 0,
            product: null,
            cancel: null,
          })),
        );
        client = new JobClient(compute.createWorker(), {
          kernels: await compute.kernels(),
          epoch: compute.epoch,
          wasmUrl: compute.wasmUrl,
        });
        const { et0 } = await client.ready;
        if (compute.publish && et0 !== null) await client.publish(compute.publish(et0));
        for (let i = 0; i < compute.jobs.length; i++) {
          if (disposed) return;
          const def = compute.jobs[i]!;
          const spec = def.spec(et0 ?? 0);
          let partialCount = 0;
          const run = client.run(spec, (e) => {
            if (e.partial) {
              partialCount += 1;
              patch(i, { pct: e.pct, partials: partialCount, product: e.partial });
            } else {
              patch(i, { pct: e.pct });
            }
          });
          patch(i, { status: 'running', cancel: run.cancel });
          try {
            const product = await run.result;
            patch(i, { status: 'done', pct: 100, product, cancel: null });
          } catch (err) {
            patch(i, {
              status:
                err instanceof JobClientCancelled
                  ? 'cancelled'
                  : { error: err instanceof Error ? err.message : String(err) },
              cancel: null,
            });
          }
        }
      } catch (err) {
        if (!disposed) setFault(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      client?.dispose();
    };
  }, [data, jobDefs]);

  return (
    <div data-testid="panel-surface">
      {fault && (
        <p data-testid="panel-fault" style={{ color: '#f47067' }}>
          {fault}
        </p>
      )}
      {hostProducts.map((product, i) => (
        <section key={i} data-testid="panel-host-product">
          <ProvenanceChip provenance={product.provenance} />
          <ProductView product={product} />
        </section>
      ))}
      {jobs.map((job, i) => (
        <section
          key={job.label}
          data-testid={`panel-job-${i}`}
          data-status={typeof job.status === 'object' ? 'error' : job.status}
          data-partials={job.partials}
          style={{ border: '1px solid #3335', borderRadius: 6, padding: 10, marginBottom: 10 }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ProgressRing pct={job.pct} active={job.status === 'running'} />
            <strong style={{ flex: 1 }}>{job.label}</strong>
            <Tag tone={job.status === 'done' ? 'green' : job.status === 'running' ? 'cyan' : 'neutral'}>
              {typeof job.status === 'object' ? 'error' : job.status}
            </Tag>
            {job.cancel && (
              <button data-testid={`panel-cancel-${i}`} onClick={() => job.cancel?.()}>
                Cancel
              </button>
            )}
          </header>
          {typeof job.status === 'object' && <p style={{ color: '#f47067' }}>{job.status.error}</p>}
          {job.product && <ProvenanceChip provenance={job.product.provenance} />}
          {job.product && <ProductView product={job.product} />}
        </section>
      ))}
    </div>
  );
}
