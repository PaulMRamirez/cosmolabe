// Saved scripts render as a per-row list (a Load action plus a per-row remove), matching
// BookmarksPanel. Loading is a direct per-row click that fires onLoadSaved(name) every
// time, so the reset-to-saved workflow re-runs without any controlled-select dance, and
// deletion is a per-row remove that fires onDeleteSaved(name) for that row's script.
//
// No DOM here: we render the element, walk it for a row's Load and remove buttons by
// their per-name test ids, invoke their onClick handlers, and assert the right name
// reaches each handler.

import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type * as React from 'react';
import type { ScriptConsoleProps } from './ScriptConsole.tsx';

let states: unknown[] = [];
let cursor = 0;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof React>('react');
  return {
    ...actual,
    useState: <T,>(init: T): [T, (v: T | ((prev: T) => T)) => void] => {
      const i = cursor++;
      if (i >= states.length) states[i] = init;
      const set = (v: T | ((prev: T) => T)): void => {
        states[i] = typeof v === 'function' ? (v as (prev: T) => T)(states[i] as T) : v;
      };
      return [states[i] as T, set];
    },
    // useRef is a stable mutable cell keyed by call order, mirroring useState's slot
    // model so refs survive across the manual re-renders these tests drive.
    useRef: <T,>(init: T): { current: T } => {
      const i = cursor++;
      if (i >= states.length) states[i] = { current: init };
      return states[i] as { current: T };
    },
  };
});

const { ScriptConsole } = await import('./ScriptConsole.tsx');

function findByTestId(node: unknown, id: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const k of node) {
      const hit = findByTestId(k, id);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (props['data-testid'] === id) return node;
  return findByTestId(props.children, id);
}

const base: ScriptConsoleProps = {
  source: 'gotoObject Earth',
  onChange: () => undefined,
  onRun: () => undefined,
  log: [],
  onClearLog: () => undefined,
  verbs: [{ verb: 'gotoObject', arity: 1 }],
  savedScriptNames: ['flyby', 'survey'],
  onSave: () => undefined,
  onLoadSaved: () => undefined,
  onDeleteSaved: () => undefined,
};

function render(props: ScriptConsoleProps): ReactElement {
  cursor = 0;
  return ScriptConsole(props) as ReactElement;
}

describe('@bessel/ui ScriptConsole saved scripts', () => {
  it('loads a saved script from its per-row Load action, re-firing on every click', () => {
    states = [];
    const onLoadSaved = vi.fn();
    const tree = render({ ...base, onLoadSaved });
    const load = findByTestId(tree, 'script-load-flyby')!;
    (load.props as { onClick: () => void }).onClick();
    (load.props as { onClick: () => void }).onClick();
    expect(onLoadSaved).toHaveBeenCalledTimes(2);
    expect(onLoadSaved).toHaveBeenCalledWith('flyby');
  });

  it('shows an empty state when there are no saved scripts', () => {
    states = [];
    const tree = render({ ...base, savedScriptNames: [] });
    expect(findByTestId(tree, 'script-saved-list')).toBeNull();
    expect(JSON.stringify(tree)).toContain('No saved scripts yet');
  });

  it('disables Copy log when the log is empty and enables it with lines', () => {
    states = [];
    const empty = findByTestId(render({ ...base, log: [] }), 'script-copy-log')!;
    expect((empty.props as { disabled: boolean }).disabled).toBe(true);
    states = [];
    const filled = findByTestId(render({ ...base, log: ['ran: gotoObject Earth'] }), 'script-copy-log')!;
    expect((filled.props as { disabled: boolean }).disabled).toBe(false);
  });

  it('defaults the verb reference open so it is visible without an extra click', () => {
    states = [];
    const details = render(base).props.children.find(
      (c: ReactElement | null) =>
        isValidElement(c) && (c.props as { className?: string }).className === 'bessel-script-ref',
    );
    expect((details.props as { open: boolean }).open).toBe(true);
  });

  it('removes a saved script from its per-row delete control', () => {
    states = [];
    const onDeleteSaved = vi.fn();
    const tree = render({ ...base, onDeleteSaved });
    const del = findByTestId(tree, 'script-delete-survey')!;
    (del.props as { onClick: () => void }).onClick();
    expect(onDeleteSaved).toHaveBeenCalledWith('survey');
  });
});

// The recall ring buffer lives in component state (useState/useRef), so we drive it
// the same way the saved-scripts tests do: render, fire a handler, re-render to read
// the next state. A small fake mirrors the textarea event we gate on (key, caret,
// preventDefault), and a controlled-source holder feeds onChange back into source.
type KeyEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  preventDefault: () => void;
  currentTarget: { value: string; selectionStart: number; selectionEnd: number };
};

function keyEvent(key: string, value: string, caret: number, mods: { meta?: boolean } = {}): KeyEvent {
  return {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    currentTarget: { value, selectionStart: caret, selectionEnd: caret },
  };
}

function fireKey(tree: ReactElement, ev: KeyEvent): void {
  const input = findByTestId(tree, 'script-input')!;
  (input.props as { onKeyDown: (e: KeyEvent) => void }).onKeyDown(ev);
}

describe('@bessel/ui ScriptConsole command history', () => {
  it('recalls prior submitted sources with ArrowUp at the caret start and ArrowDown at the end', () => {
    states = [];
    let source = '';
    const onChange = vi.fn((s: string) => {
      source = s;
    });
    const onRun = vi.fn();

    // Submit two distinct sources to seed the ring buffer.
    source = 'gotoObject Earth';
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('Enter', source, 0, { meta: true }));
    expect(onRun).toHaveBeenCalledTimes(1);
    source = 'pause';
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('Enter', source, 0, { meta: true }));
    expect(onRun).toHaveBeenCalledTimes(2);

    // ArrowUp at offset 0 recalls the newest entry, then the older one.
    source = '';
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('ArrowUp', source, 0));
    expect(source).toBe('pause');
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('ArrowUp', source, 0));
    expect(source).toBe('gotoObject Earth');

    // ArrowDown at the caret end walks back toward the newest, then to the saved draft.
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('ArrowDown', source, source.length));
    expect(source).toBe('pause');
    fireKey(render({ ...base, source, onChange, onRun }), keyEvent('ArrowDown', source, source.length));
    expect(source).toBe('');
  });

  it('does not recall when the caret is mid-text (ArrowUp not at start, ArrowDown not at end)', () => {
    states = [];
    let source = '';
    const onChange = vi.fn((s: string) => {
      source = s;
    });
    source = 'gotoObject Earth';
    fireKey(render({ ...base, source, onChange }), keyEvent('Enter', source, 0, { meta: true }));

    source = 'abc';
    fireKey(render({ ...base, source, onChange }), keyEvent('ArrowUp', source, 1));
    fireKey(render({ ...base, source, onChange }), keyEvent('ArrowDown', source, 1));
    expect(onChange).not.toHaveBeenCalled();
    expect(source).toBe('abc');
  });

  it('dedups consecutive duplicate submissions in the buffer', () => {
    states = [];
    let source = '';
    const onChange = vi.fn((s: string) => {
      source = s;
    });
    source = 'pause';
    fireKey(render({ ...base, source, onChange }), keyEvent('Enter', source, 0, { meta: true }));
    fireKey(render({ ...base, source, onChange }), keyEvent('Enter', source, 0, { meta: true }));

    // Only one entry exists: a single ArrowUp recalls it and a second is a no-op.
    source = '';
    fireKey(render({ ...base, source, onChange }), keyEvent('ArrowUp', source, 0));
    expect(source).toBe('pause');
    fireKey(render({ ...base, source, onChange }), keyEvent('ArrowUp', source, 0));
    expect(source).toBe('pause');
  });

  it('still runs on Cmd/Ctrl+Enter without recalling', () => {
    states = [];
    const onRun = vi.fn();
    const tree = render({ ...base, onRun });
    fireKey(tree, keyEvent('Enter', base.source, 0, { meta: true }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
