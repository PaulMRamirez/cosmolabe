// Per-tool run feedback for the analysis actions: while a compute is in flight the
// button reads "Computing..." and is disabled (busyLabel); after it finishes a small
// note shows a green "Done" tag or, on a hard failure, a red "Failed" tag plus a loud
// located error (role=alert). Precondition cases (no spacecraft) succeed quietly.

import { Tag } from '@bessel/selene-design';
import type { RunStatus } from '../store/index.ts';

/** Derive a button's label + disabled state from its run status. */
export function busyLabel(
  status: RunStatus | undefined,
  idle: string,
  busy: string,
): { label: string; disabled: boolean } {
  return status === 'running' ? { label: busy, disabled: true } : { label: idle, disabled: false };
}

/** A located run-status note under a result block: nothing while idle/running, a green
 *  Done tag on success, or a red Failed tag plus the loud error on a hard failure. */
export function RunStatusNote(props: { status: RunStatus | undefined; id: string }): JSX.Element | null {
  const s = props.status;
  if (s == null || s === 'idle' || s === 'running') return null;
  if (s === 'ok') {
    return (
      <span data-testid={`${props.id}-status`} style={{ display: 'inline-flex', marginTop: 4 }}>
        <Tag tone="green">Done</Tag>
      </span>
    );
  }
  return (
    <div data-testid={`${props.id}-status`} style={{ marginTop: 4 }}>
      <span style={{ display: 'inline-flex' }}>
        <Tag tone="red">Failed</Tag>
      </span>
      <p className="bessel-run-error" role="alert" data-testid={`${props.id}-error`}>
        {s.error}
      </p>
    </div>
  );
}
