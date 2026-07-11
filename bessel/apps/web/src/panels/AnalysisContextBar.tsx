// The shared analysis context bar at the top of the Analyze dock. It drives the span,
// grid, target, observer, and frame that every analysis tab reads by default (a tab can
// override locally). The run epoch is the live timeline epoch, shown read-only with its
// time-system tag, so every tool already shares it. A frame can be a common SPICE frame
// or a custom name (validated loudly at run time through the existing geometry path).

import { COMMON_SPICE_FRAMES, type TimeSystem } from '@bessel/ui';
import type { BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';
import { StationRegistryControl } from './StationRegistryControl.tsx';

const TIME_SYSTEMS: readonly TimeSystem[] = ['UTC', 'TDB'];

export interface AnalysisContextBarProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
}

export function AnalysisContextBar({ engine, store }: AnalysisContextBarProps): JSX.Element {
  const ctx = useStore(store, (s) => s.analysisContext);
  const timeSystem = useStore(store, (s) => s.timeSystem);
  const epochLabel = useStore(store, (s) => s.epochLabel);
  const objects = useStore(store, (s) => s.objects);
  const names = objects.map((o) => o.name);
  const spanDays = ctx.spanSec / 86400;
  const frameOptions = COMMON_SPICE_FRAMES.includes(ctx.frame)
    ? COMMON_SPICE_FRAMES
    : [ctx.frame, ...COMMON_SPICE_FRAMES];

  return (
    <div
      className="bessel-analysis-context-bar"
      role="group"
      aria-label="Shared analysis context"
      data-testid="analysis-context-bar"
    >
      <span className="bessel-context-epoch" data-testid="ctx-epoch">
        Epoch {epochLabel || '(timeline)'} {timeSystem}
      </span>
      <div className="bessel-context-time" role="group" aria-label="Time system">
        {TIME_SYSTEMS.map((sys) => (
          <button
            key={sys}
            type="button"
            aria-pressed={timeSystem === sys}
            data-testid={`ctx-time-${sys.toLowerCase()}`}
            onClick={() => engine?.setTimeSystem(sys)}
          >
            {sys}
          </button>
        ))}
      </div>
      <label>
        Span (days)
        <input
          type="number"
          min={0.01}
          step={0.5}
          value={spanDays}
          data-testid="ctx-span-days"
          onChange={(ev) =>
            engine?.setAnalysisContext({ spanSec: Math.max(60, Number(ev.target.value) * 86400) })
          }
        />
      </label>
      <label>
        Step (s)
        <input
          type="number"
          min={1}
          value={ctx.stepSec}
          data-testid="ctx-step-sec"
          onChange={(ev) =>
            engine?.setAnalysisContext({ stepSec: Math.max(1, Number(ev.target.value)) })
          }
        />
      </label>
      <label>
        Target
        <select
          value={ctx.target}
          data-testid="ctx-target"
          onChange={(ev) => engine?.setAnalysisContext({ target: ev.target.value })}
        >
          <option value="">(default)</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Observer
        <select
          value={ctx.observer}
          data-testid="ctx-observer"
          onChange={(ev) => engine?.setAnalysisContext({ observer: ev.target.value })}
        >
          <option value="">(default)</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Frame
        <select
          value={ctx.frame}
          data-testid="ctx-frame"
          onChange={(ev) => engine?.setAnalysisContext({ frame: ev.target.value })}
        >
          {frameOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <input
        className="bessel-context-frame-custom"
        aria-label="Custom SPICE frame"
        placeholder="custom frame"
        data-testid="ctx-frame-custom"
        onBlur={(ev) => {
          const f = ev.target.value.trim();
          if (f) engine?.setAnalysisContext({ frame: f.toUpperCase() });
          ev.target.value = '';
        }}
      />
      {/* [ux-p2-access] Ground stations are first-class shared context: the access/comms cards read
          the ACTIVE station by role, so the registry control lives in the shared context bar. */}
      <StationRegistryControl
        engine={engine}
        store={store}
        onUpdateStation={(s) => engine?.updateStation(s)}
      />
    </div>
  );
}
