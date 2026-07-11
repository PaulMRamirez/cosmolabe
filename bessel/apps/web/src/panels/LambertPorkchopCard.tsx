// The configurable Lambert transfer + PORKCHOP card (analysis-UX Phase 2, design section 3 tab 1).
// Replaces the hardcoded quarter-revolution Lambert card with a configurable transfer: departure
// and arrival bodies, a departure-window day range, and a time-of-flight day range (PorkchopForm).
// Running it sweeps a bounded (departure x TOF) grid, solving Lambert about the central body at
// each node, and renders a delta-v contour (PorkchopPlot) with the minimum marked, plus a single-
// solution readout. A "Send to MCS" action appends the marked optimum's burn to the editable MCS
// so the designer flows porkchop -> MCS without re-typing. Presentational; the sweep runs in the
// engine behind the lazy seam. The legacy single-solve (compute-transfer) stays available below.

import { useMemo, useState } from 'react';
import { Button } from '@bessel/selene-design';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { StatResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { Action, Keep, fmt, useTrayFull } from './analysis-shared.tsx';
import { PorkchopPlot } from './PorkchopPlot.tsx';
import { PorkchopForm, DEFAULT_PORKCHOP_FORM, type PorkchopFormState } from './PorkchopForm.tsx';

export interface LambertPorkchopCardProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly scalarCsv: (rows: readonly (readonly (string | number)[])[]) => string;
}

const GRID = 12;

export function LambertPorkchopCard(props: LambertPorkchopCardProps): JSX.Element {
  const { engine, store, scalarCsv } = props;
  const [form, setForm] = useState<PorkchopFormState>(DEFAULT_PORKCHOP_FORM);
  const runStatus = useStore(store, (s) => s.runStatus);
  const porkchop = useStore(store, (s) => s.porkchop);
  // [ux-p3-conjunction] The off-main-thread sweep run slice (progress + cancel).
  const porkchopRun = useStore(store, (s) => s.porkchopRun);
  const transfer = useStore(store, (s) => s.transfer);
  const objects = useStore(store, (s) => s.objects);
  const trayFull = useTrayFull(store);

  // The body select offers the loaded objects plus the common transfer bodies, de-duplicated. A
  // heliocentric transfer is posed against planet BARYCENTERS (what an ephemeris like de440 carries
  // for planet positions; a planet body-center such as 499 needs an extra satellite SPK), so the
  // built-in planet choices are barycenter names, which resolve against both the bounded fixture
  // ephemeris and a full kernel set.
  const bodyOptions = useMemo(() => {
    const names = new Set<string>([
      'SUN',
      'EARTH',
      'MARS BARYCENTER',
      'VENUS BARYCENTER',
      'JUPITER BARYCENTER',
    ]);
    for (const o of objects) names.add(o.name);
    return Array.from(names);
  }, [objects]);

  const best = porkchop?.best ?? null;
  const sweepRunning = porkchopRun.status === 'running';

  return (
    <>
      <PorkchopForm value={form} bodyOptions={bodyOptions} onChange={setForm} />

      <Action
        variant="primary"
        status={sweepRunning ? 'running' : runStatus['compute-porkchop']}
        onClick={() =>
          void engine?.computePorkchop({
            departureBody: form.departureBody,
            arrivalBody: form.arrivalBody,
            centerBody: form.centerBody,
            departureDay0: form.departureDay0,
            departureDay1: form.departureDay1,
            tofDay0: form.tofDay0,
            tofDay1: form.tofDay1,
            departureSamples: GRID,
            tofSamples: GRID,
          })
        }
        testId="compute-porkchop"
      >
        Sweep porkchop (worker)
      </Action>
      {/* [ux-p3-conjunction] Off-main-thread sweep progress + cancel, mirroring the screening worker UX. */}
      {sweepRunning ? (
        <>
          <p className="bessel-analysis-stat" data-testid="porkchop-progress">
            Sweeping {porkchopRun.done}/{porkchopRun.total} departure columns...
          </p>
          <Button variant="ghost" testId="porkchop-cancel" onClick={() => void engine?.cancelPorkchop()}>
            Cancel
          </Button>
        </>
      ) : null}
      <RunStatusNote status={runStatus['compute-porkchop']} id="compute-porkchop" />

      {porkchop && best ? (
        <div data-testid="porkchop-result">
          <PorkchopPlot result={porkchop} />
          <p className="bessel-analysis-stat" data-testid="porkchop-best">
            minimum departure delta-v {fmt(best.deltaVKmS, 4)} km/s at +
            {fmt((best.departureEt - porkchop.departureEt[0]!) / 86400, 1)} d departure, TOF{' '}
            {fmt(best.tofSec / 86400, 1)} d
          </p>
          <Action
            status={runStatus['send-to-mcs']}
            onClick={() => void engine?.sendPorkchopToMcs()}
            testId="send-to-mcs"
          >
            Send to MCS
          </Action>
          <RunStatusNote status={runStatus['send-to-mcs']} id="send-to-mcs" />
          <Keep
            domain="orbit-porkchop"
            disabled={trayFull}
            onKeep={() => engine?.keepSnapshot('orbit-porkchop')}
          />
        </div>
      ) : (
        <p className="bessel-loader-hint">
          Sweep a departure window crossed with a time-of-flight range; the porkchop contour of
          departure delta-v renders with the minimum marked, and you can send that transfer to a
          new MCS maneuver.
        </p>
      )}

      <Action
        status={runStatus['compute-transfer']}
        onClick={() => void engine?.computeTransfer()}
        testId="compute-transfer"
      >
        Single quarter-rev solve
      </Action>
      <StatResult
        show={!!transfer}
        resultTestId="transfer-result"
        hint="Single Lambert arc departure delta-v over a quarter-revolution transfer."
        csv={
          transfer
            ? {
                testId: 'transfer-csv',
                filename: 'transfer.csv',
                build: () =>
                  scalarCsv([
                    ['arc', transfer.label],
                    ['delta_v_km_s', transfer.deltaVKmS],
                    ['tof_hours', transfer.tofHours],
                  ]),
              }
            : undefined
        }
      >
        {transfer && (
          <>
            {transfer.label}: delta-v {fmt(transfer.deltaVKmS, 4)} km/s over {fmt(transfer.tofHours, 1)} h
          </>
        )}
      </StatResult>
      <RunStatusNote status={runStatus['compute-transfer']} id="compute-transfer" />
    </>
  );
}
