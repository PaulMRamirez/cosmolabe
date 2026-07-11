// @bessel/panel: the embeddable analysis surface of ADR M-0007. mount() is
// the embed contract transcribed from docs/design/02 section 7: a host page
// hands over a DOM node and a HostDataAdapter and gets the four M-0004
// product forms rendered with provenance, progress, and cancel. v0 realities,
// stated loudly rather than papered over: the compute axis implements only
// 'transfer' (transferable-buffer compute is the M-0007 baseline; 'threads'
// is the opportunistic upgrade behind the SharedArrayBuffer probe and
// 'iframe' is the M-0010 isolation posture, both unimplemented and both
// thrown on request); the profile key is carried for signature fidelity and
// consumed when the profiles package lands. The panel computes through the
// worker substrate only, so every product it materializes carries
// authority 'exploratory' by construction (iron rule 4); host products
// arrive through the adapter with whatever authority the host asserted.

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AnalysisProduct,
  JobSpec,
  SubstrateWorker,
  WireSpkPublication,
} from '@bessel/compute';
import { PanelSurface } from './PanelSurface.tsx';
import { HostBridge, type PanelSelection, type PanelSpan } from './host-bridge.ts';

export type PanelComputeMode = 'threads' | 'transfer' | 'iframe';

/** One job the host asks the panel to materialize through fallback compute. */
export interface PanelJob {
  readonly label: string;
  /** Build the spec once the worker resolves the host's epoch (et0). */
  spec(et0: number): JobSpec;
}

/**
 * The compute half of the adapter: everything the panel needs to stand up
 * one substrate worker. Worker construction stays with the host because only
 * the host's bundler can resolve the worker and wasm URLs (the substrate
 * protocol's own rule).
 */
export interface HostComputeAdapter {
  kernels(): Promise<readonly { readonly name: string; readonly bytes: Uint8Array }[]>;
  createWorker(): SubstrateWorker;
  readonly epoch?: string;
  readonly wasmUrl?: string;
  /** Synthetic ephemerides to publish before the jobs run (provenance-tracked). */
  publish?(et0: number): readonly WireSpkPublication[];
  readonly jobs: readonly PanelJob[];
}

/**
 * HostDataAdapter v0: a host supplies finished products, fallback compute,
 * or both. This is the only door through which authority 'host' can ever
 * enter the panel, and no host data adapter asserting it exists yet; that
 * door opens by ADR, not here.
 */
export interface HostDataAdapter {
  products?(): Promise<readonly AnalysisProduct[]>;
  readonly compute?: HostComputeAdapter;
}

export interface PanelConfig {
  readonly data: HostDataAdapter;
  /** Probe-resolved when omitted; v0's probe resolves 'transfer'. */
  readonly compute?: PanelComputeMode;
  /** Render/compute profile overrides, Partial<RenderProfile & ComputeProfile>
   *  once the profiles package exists; carried, not yet consumed. */
  readonly profile?: Readonly<Record<string, unknown>>;
}

/**
 * PanelController v0 plus the host sync surface (Session 8): the "one small
 * spec" of docs/design/01, kept identical for every embed host (Aerie,
 * MMGIS-shaped, or otherwise). The time cursor flows both ways, selection
 * flows out, focus flows in, and the mounted content's time span flows out
 * so the host can scale its own cursor control. Times are ET seconds at
 * this contract (iron rule 9); civil-time deep links convert at the
 * boundary via the mmgis-deep-link module.
 */
export interface PanelController {
  /** Unmount the surface; the effect cleanup tears the worker down. */
  dispose(): void;
  /** Host to panel: move the shared time cursor (ET seconds; null clears). */
  setCursor(et: number | null): void;
  /** Panel to host: cursor picks made inside the panel. Returns unsubscribe. */
  onCursor(listener: (et: number) => void): () => void;
  /** Host to panel: focus a mounted product by its key (host-N or job-N). */
  focusProduct(key: string): void;
  /** Panel to host: the user selected a product card. Returns unsubscribe. */
  onSelection(listener: (selection: PanelSelection) => void): () => void;
  /** Panel to host: the mounted content's time span, once known (fires
   *  immediately if already known). Returns unsubscribe. */
  onSpan(listener: (span: PanelSpan) => void): () => void;
}

function resolveComputeMode(requested: PanelComputeMode | undefined): PanelComputeMode {
  if (requested === undefined) return 'transfer';
  if (requested !== 'transfer') {
    throw new Error(
      `@bessel/panel v0 implements only the 'transfer' compute mode; '${requested}' is ` +
        (requested === 'threads'
          ? 'the M-0007 SharedArrayBuffer upgrade'
          : 'the M-0010 isolation posture') +
        ' and lands behind the capability probe, not silently here.',
    );
  }
  return requested;
}

export function mount(node: HTMLElement, cfg: PanelConfig): PanelController {
  resolveComputeMode(cfg.compute);
  const bridge = new HostBridge();
  const root = createRoot(node);
  root.render(createElement(PanelSurface, { data: cfg.data, bridge }));
  return controllerFor(bridge, () => root.unmount());
}

/** The controller is a thin delegation over the bridge, factored so the
 *  contract is unit-testable without a DOM root. */
export function controllerFor(bridge: HostBridge, dispose: () => void): PanelController {
  return {
    dispose,
    setCursor: (et) => bridge.setCursor(et),
    onCursor: (l) => bridge.onCursor(l),
    focusProduct: (key) => bridge.focusProduct(key),
    onSelection: (l) => bridge.onSelection(l),
    onSpan: (l) => bridge.onSpan(l),
  };
}

export { HostBridge, type PanelSelection, type PanelSpan } from './host-bridge.ts';
export {
  parseMmgisParams,
  formatMmgisParams,
  cursorEtFromStartTime,
  startTimeFromCursorEt,
  type MmgisPanelLink,
} from './mmgis-deep-link.ts';
export {
  createMmgisDataAdapter,
  mmgisLayerToGeoLayer,
  mmgisLayerToProduct,
  type MmgisComputedLayer,
} from './mmgis-adapter.ts';
export { PanelSurface, ProductView, ProvenanceChip } from './PanelSurface.tsx';
export { fieldToCells, layerToLonLat, type FieldCellRect } from './mappers.ts';
