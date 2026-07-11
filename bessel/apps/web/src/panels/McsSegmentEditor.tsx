// The editable Mission Control Sequence segment editor: renders the ordered segment list as a
// set of rows (one per segment, data-testid mcs-segment-<i>) with that segment's key params,
// reorder (up/down), and remove controls, plus an add-segment menu (mcs-add-segment). All edits
// dispatch through the pure mcsEditorReducer the parent owns, so this component is presentational.
// (analysis-UX Phase 1, design section 3 tab 1.)

import { Button, Icon } from '@bessel/selene-design';
import type {
  EditableMcs,
  EditableSegment,
  EditableSegmentKind,
  EditableTarget,
  McsEditorAction,
} from '../engine/mcs-editor.ts';

export interface McsSegmentEditorProps {
  readonly design: EditableMcs;
  readonly dispatch: (action: McsEditorAction) => void;
}

const ADD_KINDS: readonly EditableSegmentKind[] = ['InitialState', 'Propagate', 'Maneuver', 'Target'];
const GOAL_TYPES: readonly EditableTarget['goalType'][] = ['Radius', 'SMA', 'RadiusOfApoapsis'];

const num = (v: string, floor = 0): number => Math.max(floor, Number(v));

export function McsSegmentEditor(props: McsSegmentEditorProps): JSX.Element {
  const { design, dispatch } = props;
  const segs = design.segments;

  return (
    <div className="bessel-analysis-params" data-testid="mcs-segment-editor">
      <div data-testid="mcs-add-segment" role="group" aria-label="Add segment" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {ADD_KINDS.map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            testId={`mcs-add-${kind.toLowerCase()}`}
            onClick={() => dispatch({ type: 'add', kind })}
          >
            + {kind}
          </Button>
        ))}
      </div>

      {segs.map((seg, i) => (
        <div key={seg.id} data-testid={`mcs-segment-${i}`} className="bessel-mcs-segment">
          <div className="bessel-mcs-segment-head">
            <span className="bessel-panel-title">
              {i + 1}. {seg.kind}
            </span>
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Button
                variant="ghost"
                iconOnly
                testId={`mcs-segment-${i}-up`}
                disabled={i === 0}
                onClick={() => dispatch({ type: 'move', id: seg.id, dir: -1 })}
                title="Move up"
                ariaLabel="Move segment up"
              >
                <Icon name="chevron-up" />
              </Button>
              <Button
                variant="ghost"
                iconOnly
                testId={`mcs-segment-${i}-down`}
                disabled={i === segs.length - 1}
                onClick={() => dispatch({ type: 'move', id: seg.id, dir: 1 })}
                title="Move down"
                ariaLabel="Move segment down"
              >
                <Icon name="chevron-down" />
              </Button>
              <Button
                variant="ghost"
                iconOnly
                testId={`mcs-segment-${i}-remove`}
                onClick={() => dispatch({ type: 'remove', id: seg.id })}
                title="Remove segment"
                ariaLabel="Remove segment"
              >
                <Icon name="close" />
              </Button>
            </span>
          </div>
          {segmentFields(seg, i, dispatch)}
        </div>
      ))}
    </div>
  );
}

/** The per-kind key-parameter inputs for one segment row. */
function segmentFields(
  seg: EditableSegment,
  i: number,
  dispatch: (action: McsEditorAction) => void,
): JSX.Element {
  const patch = (patchObj: Partial<EditableSegment>): void =>
    dispatch({ type: 'patch', id: seg.id, patch: patchObj });
  switch (seg.kind) {
    case 'InitialState':
      return (
        <label>
          Altitude (km)
          <input
            type="number"
            min={100}
            step={50}
            value={seg.altitudeKm}
            data-testid={`mcs-segment-${i}-altitude`}
            onChange={(ev) => patch({ altitudeKm: num(ev.target.value, 100) })}
          />
        </label>
      );
    case 'Propagate':
      return (
        <label>
          Coast duration (s)
          <input
            type="number"
            min={60}
            step={60}
            value={seg.durationSec}
            data-testid={`mcs-segment-${i}-duration`}
            onChange={(ev) => patch({ durationSec: num(ev.target.value, 60) })}
          />
        </label>
      );
    case 'Maneuver':
      return (
        <label>
          Prograde delta-v (km/s)
          <input
            type="number"
            min={0}
            step={0.01}
            value={seg.dvKmS}
            data-testid={`mcs-segment-${i}-dv`}
            onChange={(ev) => patch({ dvKmS: num(ev.target.value) })}
          />
        </label>
      );
    case 'Target':
      return (
        <>
          <label>
            Goal
            <select
              value={seg.goalType}
              data-testid={`mcs-segment-${i}-goal`}
              onChange={(ev) => patch({ goalType: ev.target.value as EditableTarget['goalType'] })}
            >
              {GOAL_TYPES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desired (km)
            <input
              type="number"
              min={6500}
              step={100}
              value={seg.desiredKm}
              data-testid={`mcs-segment-${i}-desired`}
              onChange={(ev) => patch({ desiredKm: num(ev.target.value, 6500) })}
            />
          </label>
        </>
      );
  }
}
