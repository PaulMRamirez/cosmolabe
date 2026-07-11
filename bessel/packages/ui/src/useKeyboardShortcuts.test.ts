// Hook wiring test without a DOM: we mock React's useRef/useEffect to capture the
// effect callback and its dependency array, and a fake window to capture the
// keydown listener. The fix stores onAction in a ref and attaches the listener with
// an empty dep array, so the listener attaches ONCE (no churn on the playback hot
// path) yet always dispatches through the latest callback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type EffectFn = () => void | (() => void);

// A minimal ref/effect harness. useRef is identity-stable across "renders"; useEffect
// records the callback and deps so the test can run it deliberately, mimicking React's
// shallow dep comparison (re-run only when a dep changes).
const refs: { current: unknown }[] = [];
let refCursor = 0;
let lastEffect: { fn: EffectFn; deps: unknown[] | undefined } | null = null;
let prevDeps: unknown[] | undefined;
let cleanup: (() => void) | undefined;
let runCount = 0;

vi.mock('react', () => ({
  useRef: <T,>(initial: T): { current: T } => {
    if (refCursor >= refs.length) refs.push({ current: initial });
    return refs[refCursor++] as { current: T };
  },
  useEffect: (fn: EffectFn, deps?: unknown[]): void => {
    lastEffect = { fn, deps };
  },
}));

const listeners: Record<string, EventListener[]> = {};
const fakeWindow = {
  addEventListener: (type: string, l: EventListener) => {
    (listeners[type] ??= []).push(l);
  },
  removeEventListener: (type: string, l: EventListener) => {
    listeners[type] = (listeners[type] ?? []).filter((x) => x !== l);
  },
};

import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts';

// Drive one "render": run the hook, then apply React's effect rule (run only if the
// deps array changed by shallow comparison; an empty array runs exactly once).
function render(onAction: (action: string) => void): void {
  refCursor = 0;
  useKeyboardShortcuts(onAction as never);
  const eff = lastEffect!;
  const changed =
    prevDeps === undefined ||
    eff.deps === undefined ||
    eff.deps.length !== prevDeps.length ||
    eff.deps.some((d, i) => d !== prevDeps![i]);
  if (changed) {
    cleanup?.();
    const ret = eff.fn();
    cleanup = typeof ret === 'function' ? ret : undefined;
    runCount += 1;
  }
  prevDeps = eff.deps;
}

describe('@bessel/ui useKeyboardShortcuts', () => {
  beforeEach(() => {
    refs.length = 0;
    refCursor = 0;
    lastEffect = null;
    prevDeps = undefined;
    cleanup = undefined;
    runCount = 0;
    for (const k of Object.keys(listeners)) delete listeners[k];
    (globalThis as { window?: unknown }).window = fakeWindow;
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('attaches the keydown listener once across re-renders (empty deps, no churn)', () => {
    render(() => undefined);
    render(() => undefined); // a fresh inline callback every render
    render(() => undefined);
    // The effect ran exactly once and exactly one listener is bound: no per-render churn.
    expect(runCount).toBe(1);
    expect(listeners.keydown).toHaveLength(1);
  });

  it('dispatches through the latest callback via the ref', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(first);
    render(second); // re-render with a new callback; listener is NOT re-bound
    const keydown = listeners.keydown ?? [];
    expect(keydown).toHaveLength(1);
    // 'c' (center) is bound in the keymap; fire it and assert only the latest callback runs.
    keydown[0]!({ key: 'c', target: null, preventDefault: () => undefined } as unknown as Event);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
