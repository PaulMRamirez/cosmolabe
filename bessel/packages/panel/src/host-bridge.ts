// The host sync surface behind PanelController (docs/design/02 section 7's
// "one small spec", kept identical for every embed host): the time cursor in
// and out, selection out, product focus in, and the mounted content's time
// span out so the host can scale its own cursor control. The bridge is the
// single mutable state both sides share; the controller's methods and the
// surface's rendering both delegate here, so the contract is testable
// without a DOM. All times are ET seconds (iron rule 9); civil-time mapping
// belongs to the deep-link module at the boundary.

export interface PanelSelection {
  /** Stable product key (host products: host-N; computed jobs: job-N). */
  readonly key: string;
  readonly label: string;
  readonly authority: 'host' | 'exploratory';
}

export interface PanelSpan {
  readonly et0: number;
  readonly et1: number;
}

type Listener<T> = (value: T) => void;

export class HostBridge {
  private cursorEt: number | null = null;
  private focusedKey: string | null = null;
  private span: PanelSpan | null = null;
  private version = 0;
  private readonly renderListeners = new Set<() => void>();
  private readonly cursorListeners = new Set<Listener<number>>();
  private readonly selectionListeners = new Set<Listener<PanelSelection>>();
  private readonly spanListeners = new Set<Listener<PanelSpan>>();

  private bump(): void {
    this.version += 1;
    for (const l of this.renderListeners) l();
  }

  /** Subscribe the rendering side to any state change (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };

  getVersion = (): number => this.version;
  getCursor(): number | null {
    return this.cursorEt;
  }
  getFocused(): string | null {
    return this.focusedKey;
  }
  getSpan(): PanelSpan | null {
    return this.span;
  }

  /** Host to panel: move the shared cursor (null clears it). */
  setCursor(et: number | null): void {
    this.cursorEt = et;
    this.bump();
  }

  /** Host to panel: focus a mounted product by key. */
  focusProduct(key: string): void {
    this.focusedKey = key;
    this.bump();
  }

  /** Panel to host: a cursor pick made inside the panel. Also moves the cursor. */
  emitCursor(et: number): void {
    this.cursorEt = et;
    this.bump();
    for (const l of this.cursorListeners) l(et);
  }

  /** Panel to host: the user selected a product. */
  emitSelection(selection: PanelSelection): void {
    for (const l of this.selectionListeners) l(selection);
  }

  /** Panel to host: the mounted content's time span became known. */
  emitSpan(span: PanelSpan): void {
    this.span = span;
    this.bump();
    for (const l of this.spanListeners) l(span);
  }

  onCursor(listener: Listener<number>): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }
  onSelection(listener: Listener<PanelSelection>): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }
  onSpan(listener: Listener<PanelSpan>): () => void {
    this.spanListeners.add(listener);
    // A span that resolved before the host subscribed still reaches it.
    if (this.span) listener(this.span);
    return () => this.spanListeners.delete(listener);
  }
}
