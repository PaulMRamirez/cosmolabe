// The plugin loader surfaced in the viewer's "Plugins" menu. It surfaces the
// @bessel/catalog PluginRegistry like a Cosmographia add-on browser: each row is
// a registered mission plugin (name + description) that, when loaded, furnishes
// its declared kernels in dependency order and renders its catalog. A row can be
// expanded to inspect the ordered kernels and frames (the spiceKernels / require
// analog); Unload returns to the neutral scene (File > Unload Last Catalog).
// Presentational: it reads store slices and calls the engine; the registry stays
// pure data (packages/catalog never imports UI; the shell owns id -> component).

import { useState } from 'react';
import type { PluginRegistry } from '@bessel/catalog';
import { type BesselEngine } from '../engine/index.ts';
import { useStore, type AppStore } from '../store/index.ts';

export interface PluginsPanelProps {
  readonly engine: BesselEngine | null;
  readonly store: AppStore;
  readonly registry: PluginRegistry;
}

export function PluginsPanel(props: PluginsPanelProps): JSX.Element {
  const { engine, store, registry } = props;
  const loadedName = useStore(store, (s) => s.loadedName);
  const loadError = useStore(store, (s) => s.loadError);
  // Local mirror of registry activation: load flips it so the badge updates.
  const [activated, setActivated] = useState<readonly string[]>(() =>
    registry.list().filter((p) => registry.isActivated(p.id)).map((p) => p.id),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  const plugins = registry.list();

  const onLoad = async (id: string): Promise<void> => {
    await engine?.loadMission(registry, id);
    setActivated(registry.list().filter((p) => registry.isActivated(p.id)).map((p) => p.id));
  };

  const onUnload = (): void => {
    engine?.unloadMission();
  };

  return (
    <section className="bessel-plugins" aria-label="Plugins" data-testid="plugins-panel">
      {plugins.length === 0 ? (
        <p className="bessel-plugins-empty">No plugins registered.</p>
      ) : (
        <ul className="bessel-plugins-list" role="list">
          {plugins.map((p) => {
            const isOn = activated.includes(p.id);
            const isOpen = expanded === p.id;
            return (
              <li key={p.id} className="bessel-plugins-row" data-testid={`plugin-row-${p.id}`}>
                <div className="bessel-plugins-head">
                  <div className="bessel-plugins-meta">
                    <span className="bessel-plugins-name">{p.name}</span>
                    {p.description ? (
                      <span className="bessel-plugins-desc">{p.description}</span>
                    ) : null}
                  </div>
                  {isOn ? (
                    <span className="bessel-plugins-badge" data-testid={`plugin-activated-${p.id}`}>
                      Loaded
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onLoad(p.id)}
                    data-testid={`plugin-load-${p.id}`}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    data-testid={`plugin-detail-${p.id}`}
                  >
                    {isOpen ? 'Hide' : 'Details'}
                  </button>
                </div>
                {isOpen ? (
                  <dl className="bessel-plugins-kernels" data-testid={`plugin-kernels-${p.id}`}>
                    <dt>Kernels (load order)</dt>
                    <dd>
                      <ol>
                        {p.kernels.map((k) => (
                          <li key={k.name}>{k.name}</li>
                        ))}
                      </ol>
                    </dd>
                    {p.frames && p.frames.length > 0 ? (
                      <>
                        <dt>Frames</dt>
                        <dd>{p.frames.join(', ')}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={onUnload} data-testid="plugin-unload">
        Unload mission
      </button>
      <div className="bessel-plugins-status" data-testid="plugins-status">
        {loadError ? `Error: ${loadError}` : loadedName ? `Loaded ${loadedName}` : 'No mission loaded'}
      </div>
    </section>
  );
}
