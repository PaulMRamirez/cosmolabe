// Effect-wiring test without a DOM. We mock React's hooks to drive the Popover's
// outside-dismiss effect and capture which document events it binds. The fix binds
// pointerdown (not mousedown) so a touch tap outside closes the panel on the PWA and
// Capacitor targets, where mousedown does not fire for touch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as React from 'react';

type EffectFn = () => void | (() => void);

let openState = false;
const refs: { current: unknown }[] = [];
let refCursor = 0;
let lastEffect: { fn: EffectFn; deps: unknown[] | undefined } | null = null;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof React>('react');
  return {
    ...actual,
    useState: <T,>(_init: T): [T, (v: T) => void] => [openState as unknown as T, () => undefined],
    useRef: <T,>(initial: T): { current: T } => {
      if (refCursor >= refs.length) refs.push({ current: initial });
      return refs[refCursor++] as { current: T };
    },
    useId: () => 'popover-test-id',
    useEffect: (fn: EffectFn, deps?: unknown[]): void => {
      lastEffect = { fn, deps };
    },
  };
});

const bound: Record<string, EventListener[]> = {};

import { Popover } from './Popover.tsx';

function renderOpen(open: boolean): void {
  openState = open;
  refCursor = 0;
  Popover({ label: 'Layers', title: 'Layers', children: null });
}

describe('Popover outside-dismiss', () => {
  beforeEach(() => {
    refs.length = 0;
    refCursor = 0;
    lastEffect = null;
    openState = false;
    for (const k of Object.keys(bound)) delete bound[k];
    (globalThis as { document?: unknown }).document = {
      addEventListener: (t: string, l: EventListener) => {
        (bound[t] ??= []).push(l);
      },
      removeEventListener: (t: string, l: EventListener) => {
        bound[t] = (bound[t] ?? []).filter((x) => x !== l);
      },
    };
  });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('binds pointerdown (covers touch), not mousedown, while open', () => {
    renderOpen(true);
    lastEffect!.fn();
    expect(bound.pointerdown).toHaveLength(1);
    expect(bound.keydown).toHaveLength(1);
    // mousedown alone would miss touch taps on the PWA/Capacitor targets.
    expect(bound.mousedown ?? []).toHaveLength(0);
  });

  it('binds nothing while closed', () => {
    renderOpen(false);
    const cleanup = lastEffect!.fn();
    expect(cleanup).toBeUndefined();
    expect(bound.pointerdown ?? []).toHaveLength(0);
  });
});
