// Compact, always-mountable telemetry transport fault banner. Shared by the always-
// mounted canvas chrome (so a fault reaches the operator with no menu open) and the
// TelemetryOverlay Compare tab, so the loud-fault copy and styling have one source.
// Renders nothing when there is no fault, so it is inert in the nominal case.

import { CloseButton } from './CloseButton.tsx';

export interface FaultBannerProps {
  /** Loud transport fault from the telemetry adapter, or null when nominal. */
  readonly fault: string | null;
  /** Test id; defaults to the existing overlay contract id. */
  readonly testId?: string;
  /**
   * Optional acknowledge handler. When provided, the banner renders an acknowledge
   * control; the parent uses it to suppress this fault string until a different one
   * appears. When omitted, the banner renders exactly as before (no control).
   */
  readonly onAcknowledge?: () => void;
}

export function FaultBanner(props: FaultBannerProps): JSX.Element | null {
  if (props.fault == null) return null;
  const testId = props.testId ?? 'telemetry-fault-banner';
  if (props.onAcknowledge == null) {
    return (
      <p className="bessel-telemetry-fault" role="alert" data-testid={testId}>
        Telemetry fault: {props.fault}
      </p>
    );
  }
  return (
    <div className="bessel-telemetry-fault" role="alert" data-testid={testId}>
      <span>Telemetry fault: {props.fault}</span>
      <CloseButton
        onClose={props.onAcknowledge}
        label="Acknowledge telemetry fault"
        testId="fault-acknowledge"
      />
    </div>
  );
}
