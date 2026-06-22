// The analysis workbench surfaced in the viewer's Analysis menu. Each tool runs one
// validated core engine (events, access/coverage, rf, conjunction, attitude, mission,
// map-projection, interop) on the loaded spacecraft mission and renders the result
// through the @bessel/ui charting primitives. Presentational: it reads analysis
// slices from the store and calls engine methods; all geometry lives in the engine.
// (STK_PARITY_SPEC F5 / §4.)

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@bessel/selene-design';
import { GroundTrackMap, PanelContainer } from '@bessel/ui';
import { seriesToCsv, intervalsToCsv, tableToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import {
  useStore,
  KEPT_SNAPSHOT_LIMIT,
  type AppStore,
  type RunStatus,
  type AccessFom,
  type LinkBudgetParams,
} from '../store/index.ts';
import { IntervalResult, ResultCsv, SeriesResult, StatResult } from './analysis-result.tsx';
import {
  LinkParamsForm,
  ConjunctionParamsForm,
  ConstellationParamsForm,
  SlewParamsForm,
  isValidWalker,
  DEFAULT_LINK_PARAMS,
  DEFAULT_CONJUNCTION_PARAMS,
  DEFAULT_CONSTELLATION_PARAMS,
  DEFAULT_SLEW_PARAMS,
  type LinkParams,
  type ConjunctionParams,
  type ConstellationFormParams,
  type SlewFormParams,
} from './analysis-tool-forms.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { RAD2DEG } from '../angles.ts';
import type { ScreeningState } from '../screening-protocol.ts';

/** Comment-preamble lines recording the radio parameters a link run used, so the
 *  exported Eb/N0 series is reproducible. Empty when no run has stored params. */
function linkParamsPreamble(p: LinkBudgetParams | null): string {
  if (!p) return '';
  return (
    [
      `# link_eirp_dBW: ${p.eirpDbW}`,
      `# link_freq_GHz: ${p.freqHz / 1e9}`,
      `# link_g_over_t_dBK: ${p.gOverTDbK}`,
      `# link_data_rate_bps: ${p.dataRateBps}`,
    ].join('\n') + '\n#\n'
  );
}

export interface AnalysisPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
}

const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';

/** The coverage figure-of-merit note shared by the interval tools (access, in-FOV):
 *  "<verb> N%, M <noun>(s), max gap K min". Null when there is no result yet. */
function FomNote(props: {
  readonly fom: AccessFom | null | undefined;
  readonly verb: string;
  readonly noun: string;
  readonly plural: string;
  readonly testId: string;
}): JSX.Element | null {
  const { fom } = props;
  if (!fom) return null;
  return (
    <p className="bessel-analysis-stat" data-testid={props.testId}>
      {props.verb} {fmt(fom.percentCoverage * 100, 1)}%, {fom.accessCount} {props.noun}
      {fom.accessCount === 1 ? '' : props.plural}, max gap {fmt(fom.maxGapSec / 60, 1)} min
    </p>
  );
}

/** A panel action button (selene). While its tool is running it disables and reads
 *  "Computing...", driven by the per-tool run status. */
function Action(props: {
  onClick: () => void;
  testId: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  status?: RunStatus;
  disabled?: boolean;
}): JSX.Element {
  const busy = props.status === 'running';
  return (
    <Button
      variant={props.variant ?? 'secondary'}
      full
      testId={props.testId}
      disabled={busy || !!props.disabled}
      onClick={props.onClick}
    >
      {busy ? 'Computing...' : props.children}
    </Button>
  );
}

/** A "Keep for compare" button that snapshots a result into the compare tray. */
function Keep(props: { tool: string; disabled: boolean; onKeep: () => void }): JSX.Element {
  return (
    <Button variant="ghost" testId={`keep-${props.tool}`} disabled={props.disabled} onClick={props.onKeep}>
      Keep for compare
    </Button>
  );
}

/** The off-main-thread all-vs-all catalog screen: a Screen action that runs a dedicated
 *  worker over a deterministic synthetic catalog, a live progress readout, a Cancel button
 *  while it runs, and the flagged conjunction events (pair, TCA, miss). */
function CatalogScreen(props: {
  readonly engine: BesselEngine | null;
  readonly screening: ScreeningState;
  readonly runStatus: RunStatus | undefined;
}): JSX.Element {
  const { screening } = props;
  const running = screening.status === 'running';
  const error = typeof screening.status === 'object' ? screening.status.error : null;
  return (
    <div className="bessel-screening" data-testid="catalog-screen">
      <Action
        status={running ? 'running' : props.runStatus}
        onClick={() => void props.engine?.screenCatalog()}
        testId="screen-catalog"
      >
        Screen catalog (worker)
      </Action>
      {running ? (
        <>
          <p className="bessel-analysis-stat" data-testid="screen-progress">
            Screening {screening.done}/{screening.total} partitions...
          </p>
          <Button variant="ghost" testId="screen-cancel" onClick={() => void props.engine?.cancelScreen()}>
            Cancel
          </Button>
        </>
      ) : (
        <p className="bessel-loader-hint">
          Run an all-vs-all screen over a synthetic catalog in a dedicated worker.
        </p>
      )}
      {error ? (
        <p className="bessel-analysis-error" data-testid="screen-error">
          Screen failed: {error}
        </p>
      ) : null}
      {screening.events && screening.events.length > 0 ? (
        <ul className="bessel-analysis-list" data-testid="screen-events">
          {screening.events.map((ev) => (
            <li key={`${ev.primaryId}-${ev.secondaryId}`} data-testid="screen-event">
              {ev.primaryId} vs {ev.secondaryId}: miss {fmt(ev.missKm, 3)} km at TCA{' '}
              {fmt(ev.tca / 60, 1)} min
            </li>
          ))}
        </ul>
      ) : screening.status === 'done' ? (
        <p className="bessel-analysis-stat" data-testid="screen-events-empty">
          No conjunctions flagged below threshold.
        </p>
      ) : null}
    </div>
  );
}

export function AnalysisPanel(props: AnalysisPanelProps): JSX.Element {
  const { engine, store } = props;
  const objects = useStore(store, (s) => s.objects);
  const names = useMemo(() => objects.map((o) => o.name), [objects]);

  // The span-based tools read their span, step, and target from the shared analysis
  // context by default; a per-tool override reveals the local inputs below. The
  // secondary (conjunction) object stays local: it is conjunction-specific, not shared.
  const ctx = useStore(store, (s) => s.analysisContext);
  const [useShared, setUseShared] = useState(true);
  const [spanDays, setSpanDays] = useState(1);
  const [stepSec, setStepSec] = useState(120);
  const [target, setTarget] = useState('');
  const [secondary, setSecondary] = useState('');

  // Per-tool parameters for the four configurable tools; default to the prior demo values.
  const [link, setLink] = useState<LinkParams>(DEFAULT_LINK_PARAMS);
  const [conj, setConj] = useState<ConjunctionParams>(DEFAULT_CONJUNCTION_PARAMS);
  const [constellationParams, setConstellationParams] =
    useState<ConstellationFormParams>(DEFAULT_CONSTELLATION_PARAMS);
  const [slew, setSlew] = useState<SlewFormParams>(DEFAULT_SLEW_PARAMS);

  // Gate the constellation run on a buildable T/P so a valid-looking pair that does not
  // divide cannot fail silently inside walkerConstellation.
  const constellationValid = isValidWalker(constellationParams.totalSats, constellationParams.planes);

  const effSpanSec = useShared ? ctx.spanSec : Math.max(60, spanDays * 86400);
  const effStepSec = useShared ? ctx.stepSec : Math.max(1, stepSec);
  const effTarget = useShared ? ctx.target : target;
  const span = { spanSec: effSpanSec, stepSec: effStepSec };
  const targetSpan = { ...span, ...(effTarget ? { target: effTarget } : {}) };

  // Run-parameter metadata stamped onto every exported CSV so a result is reproducible.
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const timeSystem = useStore(store, (s) => s.timeSystem);
  const runStatus = useStore(store, (s) => s.runStatus);
  const trayFull = useStore(store, (s) => s.keptSnapshots.length) >= KEPT_SNAPSHOT_LIMIT;
  const runMeta = useMemo(
    () => ({
      epoch: epochLabel || undefined,
      timeSystem,
      frame: useShared ? ctx.frame : 'J2000',
      span: `${(effSpanSec / 86400).toFixed(2)} d`,
      step: `${effStepSec} s`,
      ...(effTarget ? { target: effTarget } : {}),
      ...(secondary ? { secondary } : {}),
    }),
    [epochLabel, timeSystem, useShared, ctx.frame, effSpanSec, effStepSec, effTarget, secondary],
  );

  // A scalar readout exports as a quantity/value table with the shared run metadata.
  const scalarCsv = (rows: readonly (readonly (string | number)[])[]): string =>
    tableToCsv(['quantity', 'value'], rows, { meta: runMeta });

  const eclipseUmbra = useStore(store, (s) => s.eclipseUmbra);
  const eclipseSpan = useStore(store, (s) => s.eclipseSpan);
  const rangeSeries = useStore(store, (s) => s.rangeSeries);
  const accessResult = useStore(store, (s) => s.accessResult);
  const fovResult = useStore(store, (s) => s.fovResult);
  const fovOk = useStore(store, (s) => s.fovOk);
  const linkSeries = useStore(store, (s) => s.linkSeries);
  const linkParams = useStore(store, (s) => s.linkParams);
  const conjunction = useStore(store, (s) => s.conjunction);
  const screening = useStore(store, (s) => s.screening);
  const constellation = useStore(store, (s) => s.constellation);
  const coverageGrid = useStore(store, (s) => s.coverageGrid);
  const slewSeries = useStore(store, (s) => s.slewSeries);
  const transfer = useStore(store, (s) => s.transfer);
  const groundTrack = useStore(store, (s) => s.groundTrack);

  return (
    <div className="bessel-analysis" data-testid="analysis-panel">
      {!props.hasSpacecraft ? (
        <p className="bessel-loader-hint" data-testid="analysis-empty-notice">
          Load a spacecraft to analyze. Tools below run on sample data.
        </p>
      ) : null}
      {/* Span/step/target come from the shared context bar by default; the override
          reveals the local inputs. Secondary (conjunction) is always local. */}
      <div className="bessel-analysis-params" data-testid="analysis-params">
        <label className="bessel-shared-toggle">
          <input
            type="checkbox"
            checked={useShared}
            onChange={(ev) => setUseShared(ev.target.checked)}
            data-testid="analysis-use-shared"
          />
          Use shared context
        </label>
        {useShared ? (
          <p className="bessel-loader-hint" data-testid="analysis-shared-indicator">
            Using shared context: {(ctx.spanSec / 86400).toFixed(2)} d span, {ctx.stepSec} s step
            {ctx.target ? `, target ${ctx.target}` : ''}.
          </p>
        ) : (
          <>
            <label>
              Span (days)
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={spanDays}
                onChange={(ev) => setSpanDays(Math.max(0.01, Number(ev.target.value)))}
                data-testid="param-span-days"
              />
            </label>
            <label>
              Step (s)
              <input
                type="number"
                min={1}
                value={stepSec}
                onChange={(ev) => setStepSec(Math.max(1, Number(ev.target.value)))}
                data-testid="param-step-sec"
              />
            </label>
            <label>
              Target (range/access)
              <select value={target} onChange={(ev) => setTarget(ev.target.value)} data-testid="param-target">
                <option value="">(default)</option>
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          Secondary (conjunction)
          <select value={secondary} onChange={(ev) => setSecondary(ev.target.value)} data-testid="param-secondary">
            <option value="">(center body)</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PanelContainer title="Geometry" testId="analysis-section-geometry">
        <Action
          variant="primary"
          status={runStatus['compute-range']}
          onClick={() => void engine?.computeRange(targetSpan)}
          testId="compute-range"
        >
          Compute range
        </Action>
        <SeriesResult
          series={rangeSeries}
          resultTestId="range-result"
          chartTestId="range-chart"
          hint="Plot the spacecraft range over the next day."
          csv={{
            testId: 'range-csv',
            filename: 'range.csv',
            build: (s) => seriesToCsv(s.et, [s.value], ['range_km'], { meta: runMeta }),
          }}
        />
        <RunStatusNote status={runStatus['compute-range']} id="compute-range" />
        <Action
          status={runStatus['compute-groundtrack']}
          onClick={() => void engine?.computeGroundTrack(span)}
          testId="compute-groundtrack"
        >
          Compute ground track
        </Action>
        {groundTrack ? (
          <div data-testid="groundtrack-result">
            <div className="bessel-panel-title">{groundTrack.label}</div>
            <GroundTrackMap
              lon={groundTrack.lon}
              lat={groundTrack.lat}
              label={groundTrack.label}
              testId="ground-track"
            />
            <ResultCsv
              testId="groundtrack-csv"
              filename="ground-track.csv"
              build={() =>
                seriesToCsv(
                  groundTrack.et,
                  [
                    Array.from(groundTrack.lon, (r) => r * RAD2DEG),
                    Array.from(groundTrack.lat, (r) => r * RAD2DEG),
                  ],
                  ['lon_deg', 'lat_deg'],
                  { meta: runMeta },
                )
              }
            />
          </div>
        ) : (
          <p className="bessel-loader-hint">Project the sub-spacecraft point over the next day.</p>
        )}
        <RunStatusNote status={runStatus['compute-groundtrack']} id="compute-groundtrack" />
      </PanelContainer>

      <PanelContainer title="Access & Coverage" testId="analysis-section-access">
        <Action
          variant="primary"
          status={runStatus['compute-access']}
          onClick={() => void engine?.computeAccess(targetSpan)}
          testId="compute-access"
        >
          Compute access
        </Action>
        <IntervalResult
          intervals={accessResult?.window ?? null}
          span={accessResult?.span ?? null}
          title={`${accessResult?.label ?? ''} access`}
          label={`${accessResult?.label ?? ''} access`}
          resultTestId="access-result"
          timelineTestId="access-timeline"
          hint="Find the spacecraft line-of-sight access to the Sun."
          csv={{
            testId: 'access-csv',
            filename: 'access.csv',
            build: (i) => intervalsToCsv(i, { meta: runMeta }),
          }}
          extra={<FomNote fom={accessResult?.fom} verb="Coverage" noun="access" plural="es" testId="access-fom" />}
        />
        <RunStatusNote status={runStatus['compute-access']} id="compute-access" />
        <Keep tool="access" disabled={!accessResult || trayFull} onKeep={() => engine?.keepSnapshot('access')} />
        <Action
          status={runStatus['compute-fov']}
          disabled={!fovOk}
          onClick={() => void engine?.computeInstrumentFov(targetSpan)}
          testId="compute-fov"
        >
          Compute in-FOV
        </Action>
        <IntervalResult
          intervals={fovResult?.window ?? null}
          span={fovResult?.span ?? null}
          title={`${fovResult?.label || 'Instrument'} in-FOV`}
          label={`${fovResult?.label || 'Instrument'} in-FOV`}
          resultTestId="fov-result"
          timelineTestId="fov-timeline"
          hint="Find when the target falls within the active sensor's nadir-pointed FOV."
          csv={{
            testId: 'fov-csv',
            filename: 'in-fov.csv',
            build: (i) => intervalsToCsv(i, { meta: runMeta }),
          }}
          extra={<FomNote fom={fovResult?.fom} verb="In view" noun="window" plural="s" testId="fov-fom" />}
        />
        <RunStatusNote status={runStatus['compute-fov']} id="compute-fov" />
        <Action
          status={runStatus['compute-eclipse']}
          onClick={() => void engine?.computeEclipse(span)}
          testId="compute-eclipse"
        >
          Compute eclipse
        </Action>
        <IntervalResult
          intervals={eclipseUmbra}
          span={eclipseSpan}
          title="Umbra intervals"
          label="Eclipse umbra"
          resultTestId="eclipse-result"
          timelineTestId="eclipse-timeline"
          hint="Compute the spacecraft eclipse over the next day."
          csv={{
            testId: 'eclipse-csv',
            filename: 'eclipse-umbra.csv',
            build: (i) => intervalsToCsv(i, { meta: runMeta }),
          }}
        />
        <RunStatusNote status={runStatus['compute-eclipse']} id="compute-eclipse" />
        <Action
          status={runStatus['compute-coverage-grid']}
          onClick={() => void engine?.computeCoverageGrid(span)}
          testId="compute-coverage-grid"
        >
          Show coverage grid
        </Action>
        {coverageGrid ? (
          <p className="bessel-analysis-stat" data-testid="coverage-grid-stat">
            {coverageGrid.label}: {fmt(coverageGrid.areaWeightedPercentCoverage * 100, 1)}% area-weighted coverage
            over {coverageGrid.cellCount} cells.
          </p>
        ) : (
          <p className="bessel-loader-hint">
            Drape a global coverage figure-of-merit grid on the globe, colored by coverage.
          </p>
        )}
        <Action
          status={runStatus['clear-coverage-grid']}
          disabled={!coverageGrid}
          onClick={() => void engine?.clearCoverageGrid()}
          testId="clear-coverage-grid"
        >
          Clear coverage grid
        </Action>
        <RunStatusNote status={runStatus['compute-coverage-grid']} id="compute-coverage-grid" />
      </PanelContainer>

      <PanelContainer title="Comms" testId="analysis-section-comms">
        <LinkParamsForm value={link} onChange={setLink} />
        <Action
          variant="primary"
          status={runStatus['compute-link']}
          onClick={() =>
            void engine?.computeLinkBudget({
              ...span,
              eirpDbW: link.eirpDbW,
              freqHz: link.freqGHz * 1e9,
              gOverTDbK: link.gOverTDbK,
              dataRateBps: link.dataRateBps,
            })
          }
          testId="compute-link"
        >
          Compute downlink Eb/N0
        </Action>
        <SeriesResult
          series={linkSeries}
          resultTestId="link-result"
          chartTestId="link-chart"
          hint="Plot the downlink Eb/N0 to a ground station."
          csv={{
            testId: 'link-csv',
            filename: 'link-ebn0.csv',
            build: (s) =>
              linkParamsPreamble(linkParams) + seriesToCsv(s.et, [s.value], ['ebN0_dB'], { meta: runMeta }),
          }}
        />
        <RunStatusNote status={runStatus['compute-link']} id="compute-link" />
        <Keep tool="link" disabled={!linkSeries || trayFull} onKeep={() => engine?.keepSnapshot('link')} />
      </PanelContainer>

      <PanelContainer title="Conjunction" testId="analysis-section-conjunction">
        <ConjunctionParamsForm value={conj} onChange={setConj} />
        <Action
          variant="primary"
          status={runStatus['compute-conjunction']}
          onClick={() =>
            void engine?.computeConjunction({
              ...(secondary ? { secondary } : {}),
              sigmaKm: conj.sigmaKm,
              radiusKm: conj.radiusKm,
            })
          }
          testId="compute-conjunction"
        >
          Compute closest approach
        </Action>
        <StatResult
          show={!!conjunction}
          resultTestId="conjunction-result"
          hint="Closest approach and collision probability for the loaded pair."
          csv={
            conjunction
              ? {
                  testId: 'conjunction-csv',
                  filename: 'conjunction.csv',
                  build: () =>
                    scalarCsv([
                      ['pair', conjunction.label],
                      ['miss_km', conjunction.missKm],
                      ['tca_s', conjunction.tcaSec],
                      ['rel_speed_km_s', conjunction.relSpeedKmS],
                      ['pc', conjunction.pc],
                      ['sigma_km', conjunction.sigmaKm],
                      ['hard_body_radius_km', conjunction.radiusKm],
                    ]),
                }
              : undefined
          }
        >
          {conjunction && (
            <>
              {conjunction.label}: miss {fmt(conjunction.missKm)} km at TCA {fmt(conjunction.tcaSec / 60, 1)} min,
              rel speed {fmt(conjunction.relSpeedKmS, 3)} km/s, Pc {conjunction.pc.toExponential(2)}
            </>
          )}
        </StatResult>
        <RunStatusNote status={runStatus['compute-conjunction']} id="compute-conjunction" />
        <Keep tool="conjunction" disabled={!conjunction || trayFull} onKeep={() => engine?.keepSnapshot('conjunction')} />
        <CatalogScreen engine={engine} screening={screening} runStatus={runStatus['screen-catalog']} />
        <RunStatusNote status={runStatus['screen-catalog']} id="screen-catalog" />
      </PanelContainer>

      <PanelContainer title="Constellation" testId="analysis-section-constellation">
        <ConstellationParamsForm value={constellationParams} onChange={setConstellationParams} />
        <Action
          variant="primary"
          status={runStatus['compute-constellation']}
          disabled={!constellationValid}
          onClick={() => engine?.computeConstellation(constellationParams)}
          testId="compute-constellation"
        >
          Design Walker constellation
        </Action>
        {!constellationValid ? (
          <p className="bessel-loader-hint" data-testid="constellation-invalid">
            Total sats (T) must be a positive multiple of the number of planes (P).
          </p>
        ) : null}
        <StatResult
          show={!!constellation}
          resultTestId="constellation-result"
          hint="Generate a Walker constellation pattern."
          csv={
            constellation
              ? {
                  testId: 'constellation-csv',
                  filename: 'constellation.csv',
                  build: () =>
                    scalarCsv([
                      ['pattern', constellation.pattern],
                      ['total_sats', constellation.totalSats],
                      ['planes', constellation.planes],
                      ['phasing', constellation.phasing],
                      ['per_plane', constellation.perPlane],
                      ['inclination_deg', constellation.inclinationDeg],
                      ['altitude_km', constellation.altitudeKm],
                    ]),
                }
              : undefined
          }
        >
          {constellation && (
            <>
              Walker {constellation.pattern} {constellation.totalSats}/{constellation.planes}/{constellation.phasing}:
              {' '}{constellation.perPlane} sats x {constellation.planes} planes at {fmt(constellation.altitudeKm, 0)} km,
              {' '}{fmt(constellation.inclinationDeg, 0)} deg
            </>
          )}
        </StatResult>
        <RunStatusNote status={runStatus['compute-constellation']} id="compute-constellation" />
      </PanelContainer>

      <PanelContainer title="Maneuver" testId="analysis-section-maneuver">
        <SlewParamsForm value={slew} onChange={setSlew} />
        <Action
          variant="primary"
          status={runStatus['compute-slew']}
          onClick={() =>
            void engine?.computeSlew({
              fromMode: slew.fromMode,
              toMode: slew.toMode,
              maxRateDeg: slew.maxRateDeg,
              maxAccelDeg: slew.maxAccelDeg,
            })
          }
          testId="compute-slew"
        >
          Compute attitude slew
        </Action>
        <SeriesResult
          series={slewSeries}
          resultTestId="slew-result"
          chartTestId="slew-chart"
          hint="Eigen-axis slew between two pointing references."
          csv={{
            testId: 'slew-csv',
            filename: 'slew.csv',
            build: (s) => seriesToCsv(s.et, [s.value], ['slew_deg'], { epochHeader: 't_s', meta: runMeta }),
          }}
        />
        <RunStatusNote status={runStatus['compute-slew']} id="compute-slew" />
        <Action
          status={runStatus['compute-transfer']}
          onClick={() => void engine?.computeTransfer()}
          testId="compute-transfer"
        >
          Solve Lambert transfer
        </Action>
        <StatResult
          show={!!transfer}
          resultTestId="transfer-result"
          hint="Lambert arc departure delta-v over a 2 h transfer."
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
      </PanelContainer>

      <PanelContainer title="Export" testId="analysis-section-export">
        <Action
          status={runStatus['export-oem']}
          onClick={() => void engine?.exportOem()}
          testId="export-oem"
        >
          Export CCSDS OEM
        </Action>
        <RunStatusNote status={runStatus['export-oem']} id="export-oem" />
      </PanelContainer>
    </div>
  );
}
