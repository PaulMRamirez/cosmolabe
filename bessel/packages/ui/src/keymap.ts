// Cosmographia-style keyboard shortcuts. The keymap and action resolution are pure
// so they are unit tested; the hook (useKeyboardShortcuts) wires them to the window.

export type KeyboardAction =
  | { readonly type: 'playToggle' }
  | { readonly type: 'scrub'; readonly direction: -1 | 1 }
  | { readonly type: 'rate'; readonly direction: -1 | 1 }
  | { readonly type: 'center' }
  | { readonly type: 'help' };

export interface KeyBinding {
  readonly key: string;
  readonly description: string;
  readonly action: KeyboardAction;
}

export const KEYMAP: readonly KeyBinding[] = [
  { key: ' ', description: 'Play or pause', action: { type: 'playToggle' } },
  { key: 'ArrowRight', description: 'Scrub forward', action: { type: 'scrub', direction: 1 } },
  { key: 'ArrowLeft', description: 'Scrub backward', action: { type: 'scrub', direction: -1 } },
  { key: 'ArrowUp', description: 'Increase rate', action: { type: 'rate', direction: 1 } },
  { key: 'ArrowDown', description: 'Decrease rate', action: { type: 'rate', direction: -1 } },
  { key: 'c', description: 'Center on selection', action: { type: 'center' } },
  { key: '?', description: 'Toggle keyboard help', action: { type: 'help' } },
];

/** Resolve a KeyboardEvent.key to an action, or null if unbound. */
export function resolveAction(key: string): KeyboardAction | null {
  const binding = KEYMAP.find((b) => b.key === key);
  return binding ? binding.action : null;
}

/** True when a keydown originated in a text input and should be ignored. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}
