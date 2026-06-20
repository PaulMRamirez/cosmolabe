// Keyboard shortcut help, shown as an accessible modal dialog. Lists the keymap;
// Escape closes it. Open state is owned by the viewer (toggled by the ? shortcut).

import { useEffect, useRef } from 'react';
import { KEYMAP } from './keymap.ts';

export interface KeyboardHelpProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function displayKey(key: string): string {
  if (key === ' ') return 'Space';
  return key.replace('Arrow', '');
}

// Mouse and camera controls handled directly by the engine (not the keymap).
const CAMERA_HELP: readonly { keys: string; description: string }[] = [
  { keys: 'Drag', description: 'Orbit / look' },
  { keys: 'Shift+Drag / Right-drag', description: 'Pan (truck)' },
  { keys: 'Wheel / Pinch', description: 'Zoom toward cursor' },
  { keys: 'W A S D', description: 'Free-fly move (Free mode)' },
  { keys: 'Q E', description: 'Free-fly down / up' },
  { keys: 'R F', description: 'Dolly forward / back (along view axis)' },
  { keys: 'T G', description: 'Crane up / down (vertical)' },
  { keys: ', .', description: 'Roll left / right' },
  { keys: '- =', description: 'Widen / narrow field of view' },
];

export function KeyboardHelp(props: KeyboardHelpProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.open) return;
    ref.current?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props]);

  if (!props.open) return null;
  return (
    <div
      className="bessel-help"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      ref={ref}
    >
      <h2>Keyboard shortcuts</h2>
      <dl>
        {KEYMAP.map((b) => (
          <div key={b.key}>
            <dt>
              <kbd>{displayKey(b.key)}</kbd>
            </dt>
            <dd>{b.description}</dd>
          </div>
        ))}
      </dl>
      <h2>Camera</h2>
      <dl>
        {CAMERA_HELP.map((b) => (
          <div key={b.keys}>
            <dt>
              <kbd>{b.keys}</kbd>
            </dt>
            <dd>{b.description}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={props.onClose}>
        Close
      </button>
    </div>
  );
}
