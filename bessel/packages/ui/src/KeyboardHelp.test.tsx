// Effect-wiring test without a DOM. We mock React's useRef/useEffect to capture the
// focus effect and its dependency array, plus a fake window/element. The fix gates the
// effect on props.open ALONE (so a viewer re-render mid-playback does not re-run it and
// yank focus back to the dialog) and dispatches Escape through an onClose ref (so the
// latest onClose is honoured without making the effect depend on it).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type EffectFn = () => void | (() => void);

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
let focusCount = 0;
const fakeEl = { focus: () => (focusCount += 1) };

import { KeyboardHelp } from './KeyboardHelp.tsx';

// One "render" pass: call the component, point its first ref (the dialog ref) at our
// focusable element, then apply React's effect rule (run only when deps change).
function render(props: { open: boolean; onClose: () => void }): void {
  refCursor = 0;
  KeyboardHelp(props);
  refs[0]!.current = fakeEl; // the dialog ref
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

describe('@bessel/ui KeyboardHelp focus effect', () => {
  beforeEach(() => {
    refs.length = 0;
    refCursor = 0;
    lastEffect = null;
    prevDeps = undefined;
    cleanup = undefined;
    runCount = 0;
    focusCount = 0;
    for (const k of Object.keys(listeners)) delete listeners[k];
    (globalThis as { window?: unknown }).window = {
      addEventListener: (t: string, l: EventListener) => {
        (listeners[t] ??= []).push(l);
      },
      removeEventListener: (t: string, l: EventListener) => {
        listeners[t] = (listeners[t] ?? []).filter((x) => x !== l);
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('does not re-grab focus on re-renders that leave open unchanged', () => {
    const onClose = vi.fn();
    render({ open: true, onClose }); // open transition: focus once
    render({ open: true, onClose: vi.fn() }); // playback tick re-render, new inline onClose
    render({ open: true, onClose: vi.fn() });
    // The focus effect ran exactly once: it depends on props.open alone, not props or
    // the inline onClose, so the Close button keeps focus while the clock plays.
    expect(runCount).toBe(1);
    expect(focusCount).toBe(1);
    expect(lastEffect!.deps).toEqual([true]);
  });

  it('honours the latest onClose on Escape via the ref', () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ open: true, onClose: first });
    render({ open: true, onClose: second }); // re-render swaps onClose; effect not re-run
    (listeners.keydown ?? [])[0]!({ key: 'Escape' } as unknown as Event);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
