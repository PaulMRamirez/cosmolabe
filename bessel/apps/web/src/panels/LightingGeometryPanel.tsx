// The Lighting & Geometry domain tab (analysis-UX re-slot, design section 3, tab 2):
// the geometry tools (spacecraft range, sub-point ground track) plus the lighting-season
// capabilities (beta-angle season, full umbra/penumbra/annular/sunlit eclipse phases,
// solar intensity), surfaced as collapsible TaskCards. Presentational: it reads result
// slices and calls engine; the lighting card bodies live in lighting-cards.tsx.

import { useState, type ReactNode } from 'react';
import { DomainIcon } from '@bessel/selene-design';
import { GroundTrackMap, type GroundTrackProjection } from '@bessel/ui';
import { seriesToCsv } from '@bessel/interop';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { ResultCsv, SeriesResult } from './analysis-result.tsx';
import { RunStatusNote } from './RunStatus.tsx';
import { TaskCardAccordion, type ExpandRequest, type TaskCardEntry } from './TaskCard.tsx';
import { Action, EmptyNotice, useAnalysisParams, useTrayFull } from './analysis-shared.tsx';
import { betaCard, eclipseCard, solarIntensityCard } from './lighting-cards.tsx';
import { RAD2DEG } from '../angles.ts';

export interface LightingGeometryPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly hasSpacecraft: boolean;
  readonly expandRequest?: ExpandRequest;
}

export function LightingGeometryPanel(props: LightingGeometryPanelProps): JSX.Element {
  const { engine, store } = props;
  const params = useAnalysisParams(store, { withTarget: true, withSecondary: false });
  const { span, targetSpan, runMeta } = params;

  const runStatus = useStore(store, (s) => s.runStatus);
  const rangeSeries = useStore(store, (s) => s.rangeSeries);
  const groundTrack = useStore(store, (s) => s.groundTrack);
  const eclipsePhases = useStore(store, (s) => s.eclipsePhases);
  const betaSeries = useStore(store, (s) => s.betaSeries);
  const solarIntensity = useStore(store, (s) => s.solarIntensitySeries);
  const trayFull = useTrayFull(store);
  // [ux-p3-coverage] The selectable ground-track projection (the map is presentational; the
  // select lives here). The scenario station registry is draped as overlay markers in the
  // SAME projection so the track and the stations stay registered.
  const [groundTrackProjection, setGroundTrackProjection] =
    useState<GroundTrackProjection>('equirectangular');
  const stations = useStore(store, (s) => s.scenario.stations);
  const stationMarkers = stations.map((s) => ({
    id: s.id,
    name: s.name,
    lonRad: s.lonRad,
    latRad: s.latRad,
  }));

  const cardCtx = { engine, span, runStatus, runMeta, trayFull };

  const rangeCard = (): ReactNode => (
    <>
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
    </>
  );

  const groundTrackCard = (): ReactNode => (
    <>
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
          <label>
            Projection
            <select
              data-testid="param-groundtrack-projection"
              value={groundTrackProjection}
              onChange={(e) => setGroundTrackProjection(e.target.value as GroundTrackProjection)}
            >
              <option value="equirectangular">Equirectangular</option>
              <option value="mercator">Web Mercator</option>
              <option value="polar-stereographic">Polar stereographic</option>
            </select>
          </label>
          <GroundTrackMap
            lon={groundTrack.lon}
            lat={groundTrack.lat}
            label={groundTrack.label}
            projection={groundTrackProjection}
            stations={stationMarkers}
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
    </>
  );

  const cards: readonly TaskCardEntry[] = [
    {
      id: 'range',
      title: 'Range to a target',
      purpose: 'Spacecraft-to-target distance over the span.',
      status: runStatus['compute-range'],
      render: rangeCard,
    },
    {
      id: 'ground-track',
      title: 'Ground track',
      icon: <DomainIcon name="ground-track" size="sm" />,
      purpose: 'Sub-spacecraft longitude/latitude over the span.',
      status: runStatus['compute-groundtrack'],
      render: groundTrackCard,
    },
    {
      id: 'beta',
      title: 'Beta-angle season',
      icon: <DomainIcon name="beta-angle" size="sm" />,
      purpose: 'Solar beta angle over the span vs the eclipse-onset threshold.',
      status: runStatus['compute-beta'],
      render: () => betaCard(cardCtx, betaSeries),
    },
    {
      id: 'eclipse',
      title: 'Eclipse phases',
      icon: <DomainIcon name="eclipse" size="sm" />,
      purpose: 'Umbra/penumbra/annular/sunlit windows + per-day duration.',
      status: runStatus['compute-eclipse'],
      render: () => eclipseCard(cardCtx, eclipsePhases),
    },
    {
      id: 'solar-intensity',
      title: 'Solar intensity',
      purpose: 'Visible solar-disk fraction (0..1) for power/thermal.',
      status: runStatus['compute-solar-intensity'],
      render: () => solarIntensityCard(cardCtx, solarIntensity),
    },
  ];

  return (
    <div className="bessel-analysis" data-testid="lighting-geometry-panel">
      <EmptyNotice hasSpacecraft={props.hasSpacecraft} />
      {params.paramsBar}
      <TaskCardAccordion
        cards={cards}
        defaultExpanded={['range', 'ground-track']}
        {...(props.expandRequest ? { expandRequest: props.expandRequest } : {})}
      />
    </div>
  );
}
