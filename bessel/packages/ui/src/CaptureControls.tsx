// Capture controls: a still-image button and a record/stop toggle. Presentational;
// the viewer supplies the canvas and capture handlers. Both controls are
// iconified: selene Icon components with accessible names via ariaLabel and Tooltip.

import { Button, Icon } from '@bessel/selene-design';
import { Tooltip } from './Tooltip';

export interface CaptureControlsProps {
  readonly recording: boolean;
  readonly onCaptureStill: () => void;
  readonly onToggleRecording: () => void;
}

export function CaptureControls(props: CaptureControlsProps): JSX.Element {
  const recordLabel = props.recording ? 'Stop recording' : 'Record video';
  return (
    <div className="bessel-capture" role="group" aria-label="Capture">
      <Tooltip label="Capture image">
        <Button
          iconOnly
          ariaLabel="Capture image"
          onClick={props.onCaptureStill}
          testId="capture-still"
        >
          <Icon name="camera" />
        </Button>
      </Tooltip>
      <Tooltip label={recordLabel}>
        <Button
          iconOnly
          variant={props.recording ? 'critical' : 'secondary'}
          ariaLabel={recordLabel}
          pressed={props.recording}
          onClick={props.onToggleRecording}
          testId="capture-record"
        >
          {props.recording ? <Icon name="stop" /> : <Icon name="record" />}
        </Button>
      </Tooltip>
    </div>
  );
}
