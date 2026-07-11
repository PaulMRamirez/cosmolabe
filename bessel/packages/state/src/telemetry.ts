// Telemetry adapter (item 6, Phase 4 real-time): a transport-neutral adapter
// that ingests live state vectors from a WebSocket-like source (Yamcs, OpenMCT)
// and pairs each actual sample with a predicted position to drive a
// predicted-versus-actual overlay. Pure over a SocketLike and a predictor, so it
// is unit-testable with a mock socket and carries no SPICE or Three.js.

export type Vec3 = readonly [number, number, number];

export interface TelemetrySample {
  /** Ephemeris time (TDB seconds) of the measurement. */
  readonly et: number;
  /** Measured position, km, in the working frame. */
  readonly position: Vec3;
}

export interface PredictedVsActual {
  readonly et: number;
  readonly predicted: Vec3;
  readonly actual: Vec3;
  /** Distance between predicted and actual, km. */
  readonly residualKm: number;
}

/** Minimal WebSocket surface the adapter needs (browser WebSocket satisfies it). */
export interface SocketLike {
  addEventListener(type: 'message', listener: (ev: { data: string }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  close(): void;
}

/** Euclidean distance (km) between two positions. */
export function residualKm(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Parse one telemetry frame: {"et": number, "position": [x,y,z]}. Throws loudly. */
export function parseTelemetryMessage(raw: string): TelemetrySample {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TelemetryError(`Telemetry frame is not JSON: ${String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TelemetryError('Telemetry frame must be an object');
  }
  const record = parsed as Record<string, unknown>;
  const et = record['et'];
  const position = record['position'];
  if (typeof et !== 'number' || !Number.isFinite(et)) {
    throw new TelemetryError('Telemetry frame is missing a numeric "et"');
  }
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new TelemetryError('Telemetry frame "position" must be three finite numbers');
  }
  return { et, position: [position[0], position[1], position[2]] as Vec3 };
}

export class TelemetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryError';
  }
}

/** How many predicted-versus-actual records the overlay retains (a ring buffer cap).
 *  Bounds memory and keeps the overlay array a fixed size over a long session. */
export const OVERLAY_HISTORY_LIMIT = 600;

export class TelemetryAdapter {
  // Each frame is paired with its prediction once, at ingest, so overlay() is O(1)
  // and the per-tick caller does not recompute the whole history (was O(n^2) when
  // polled every frame). The newest record is appended; the oldest is dropped past
  // the cap so retained history stays bounded.
  private readonly pairs: PredictedVsActual[] = [];
  private lastError: string | null = null;

  /**
   * @param socket  the live telemetry source.
   * @param predict the predicted position at an epoch (typically a SPICE sample).
   * @param historyLimit  the ring-buffer cap on retained records.
   */
  constructor(
    private readonly socket: SocketLike,
    private readonly predict: (et: number) => Vec3,
    private readonly historyLimit: number = OVERLAY_HISTORY_LIMIT,
  ) {
    socket.addEventListener('message', (ev) => this.ingest(ev.data));
  }

  private ingest(raw: string): void {
    try {
      const sample = parseTelemetryMessage(raw);
      const predicted = this.predict(sample.et);
      this.pairs.push({
        et: sample.et,
        predicted,
        actual: sample.position,
        residualKm: residualKm(predicted, sample.position),
      });
      // Trim from the front so the retained window is bounded (ring buffer).
      if (this.pairs.length > this.historyLimit) {
        this.pairs.splice(0, this.pairs.length - this.historyLimit);
      }
      this.lastError = null;
    } catch (err) {
      // Keep the stream alive but record the fault loudly for the UI to surface.
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  /** The full predicted-versus-actual series in arrival order (cached, bounded). */
  overlay(): PredictedVsActual[] {
    return this.pairs.slice();
  }

  /** The most recent comparison, or null before any sample arrives. */
  latest(): PredictedVsActual | null {
    return this.pairs[this.pairs.length - 1] ?? null;
  }

  sampleCount(): number {
    return this.pairs.length;
  }

  error(): string | null {
    return this.lastError;
  }

  dispose(): void {
    this.socket.close();
  }
}
