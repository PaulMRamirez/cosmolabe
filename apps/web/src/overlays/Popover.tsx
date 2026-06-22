// A small click-to-open popover used for canvas overlays (Layers) and top-bar
// menus (Mission, Capture, Saved views). Closes on outside click or Escape, and
// is keyboard and screen-reader operable (aria-expanded / aria-controls). The
// panel mounts only while open so its controls stay out of the tab order when
// hidden.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@bessel/selene-design';

export interface PopoverProps {
  /** Trigger button content (text or icon). */
  readonly label: ReactNode;
  /** Accessible name for the open panel. */
  readonly title: string;
  /** Which edge the panel aligns to under the trigger. */
  readonly align?: 'left' | 'right';
  readonly triggerClassName?: string;
  /** Accessible name for the trigger, required when `label` is an icon (no text). */
  readonly ariaLabel?: string;
  readonly testId?: string;
  /** When true, offer a pin toggle: a pinned panel does not auto-dismiss on an
   *  outside click, so a working surface (the Script console) survives canvas
   *  interaction. Escape still closes it. */
  readonly pinnable?: boolean;
  readonly children: ReactNode;
}

export function Popover(props: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    // pointerdown (not mousedown) so a touch tap outside dismisses on the PWA and
    // Capacitor targets; mousedown does not fire for touch on those platforms. A
    // pinned panel ignores the outside tap (but Escape still closes it).
    const onPointer = (e: PointerEvent): void => {
      if (pinned) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, pinned]);

  return (
    <div className="bessel-popover" ref={ref}>
      <button
        type="button"
        className={`bessel-popover-trigger ${props.triggerClassName ?? ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        onClick={() => setOpen((o) => !o)}
        data-testid={props.testId}
      >
        {props.label}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={props.title}
          className={`bessel-popover-panel bessel-popover-${props.align ?? 'left'}`}
        >
          {props.pinnable ? (
            <button
              type="button"
              className="bessel-popover-pin"
              aria-pressed={pinned}
              data-testid={props.testId ? `${props.testId}-pin` : undefined}
              title={pinned ? 'Unpin (close on outside click)' : 'Pin (keep open)'}
              aria-label={pinned ? 'Unpin panel' : 'Pin panel open'}
              onClick={() => setPinned((p) => !p)}
            >
              <Icon name="pin" />
            </button>
          ) : null}
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
