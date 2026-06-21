// React hook attaching the keymap to the window. Ignores keydowns from text inputs
// so typing in fields is not hijacked.

import { useEffect, useRef } from 'react';
import { isEditableTarget, resolveAction, type KeyboardAction } from './keymap.ts';

export function useKeyboardShortcuts(onAction: (action: KeyboardAction) => void): void {
  // Keep the latest callback in a ref so the listener attaches exactly once. An
  // unmemoized inline onAction would otherwise re-add/remove the keydown listener on
  // every render, churning on the playback hot path (the clock re-renders per tick).
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    const handler = (ev: KeyboardEvent): void => {
      if (isEditableTarget(ev.target)) return;
      const action = resolveAction(ev.key);
      if (!action) return;
      ev.preventDefault();
      onActionRef.current(action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
