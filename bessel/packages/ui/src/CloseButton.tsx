// The one close control used across every dismissable surface (inspector card,
// overlays, the keyboard-help and welcome cards). A top-right glyph button with a
// required accessible name, so every "close" looks and reads the same: a header
// close means CLOSE (it dismisses), distinct from a caret that only collapses.

import { Icon } from '@bessel/selene-design';

export interface CloseButtonProps {
  /** Dismiss handler. */
  readonly onClose: () => void;
  /** Accessible name and hover title, e.g. "Close selection details". */
  readonly label: string;
  /** Forwarded as data-testid for host-app test hooks. */
  readonly testId?: string;
  /** Extra class names appended after the shared bessel-close-button class. */
  readonly className?: string;
}

export function CloseButton(props: CloseButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`bessel-close-button${props.className ? ` ${props.className}` : ''}`}
      onClick={props.onClose}
      aria-label={props.label}
      title={props.label}
      data-testid={props.testId}
    >
      <Icon name="close" />
    </button>
  );
}
