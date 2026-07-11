// An in-app mock telemetry source for the predicted-versus-actual overlay, so
// the TelemetryAdapter is exercised end to end without a live Yamcs/OpenMCT
// server. The engine pushes synthetic frames (the predicted spacecraft position
// plus a small offset) into emit(); replace this with a real WebSocket when a
// telemetry server is available.

import type { SocketLike } from '@bessel/state';

export class MockTelemetrySocket implements SocketLike {
  private messageCb: ((ev: { data: string }) => void) | null = null;

  addEventListener(type: 'message' | 'close', listener: never): void {
    if (type === 'message') this.messageCb = listener as unknown as (ev: { data: string }) => void;
  }

  emit(data: string): void {
    this.messageCb?.({ data });
  }

  close(): void {
    this.messageCb = null;
  }
}
