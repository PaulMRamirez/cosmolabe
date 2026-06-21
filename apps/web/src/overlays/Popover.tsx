// A small click-to-open popover used for canvas overlays (Layers) and top-bar
// menus (Mission, Capture, Saved views). Closes on outside click or Escape, and
// is keyboard and screen-reader operable (aria-expanded / aria-controls). The
// panel mounts only while open so its controls stay out of the tab order when
// hidden.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PopoverProps {
  /** Trigger button content (text or icon). */
  readonly label: ReactNode;
  /** Accessible name for the open panel. */
  readonly title: string;
  /** Which edge the panel aligns to under the trigger. */
  readonly align?: 'left' | 'right';
  readonly triggerClassName?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

export function Popover(props: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    // pointerdown (not mousedown) so a touch tap outside dismisses on the PWA and
    // Capacitor targets; mousedown does not fire for touch on those platforms.
    const onPointer = (e: PointerEvent): void => {
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
  }, [open]);

  return (
    <div className="bessel-popover" ref={ref}>
      <button
        type="button"
        className={`bessel-popover-trigger ${props.triggerClassName ?? ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
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
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
