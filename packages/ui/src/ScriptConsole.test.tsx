// The reset-to-saved workflow must re-run when the user re-picks the SAME saved name.
// With a controlled <select value={selected}> that keeps the loaded name, re-selecting
// it fires no onChange (React only dispatches on a value change) and onLoadSaved never
// re-runs. The fix snaps the controlled value back to the placeholder ('') after each
// pick, so the next selection of that same name is again a value change.
//
// No DOM here: we drive React's useState with a real stateful harness across renders,
// invoke the select's onChange, re-render, and assert the controlled value returns to
// '' (which is what re-enables the re-fire) rather than sticking on the loaded name.

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
    useState: <T,>(init: T): [T, (v: T) => void] => {
      const i = cursor++;
      if (i >= states.length) states[i] = init;
      const set = (v: T): void => {
        states[i] = v;
      };
      return [states[i] as T, set];
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

describe('@bessel/ui ScriptConsole load select', () => {
  it('returns the controlled value to the placeholder after a pick (re-fire enabled)', () => {
    states = [];
    const onLoadSaved = vi.fn();
    // First render: pick 'flyby'.
    let tree = render({ ...base, onLoadSaved });
    let select = findByTestId(tree, 'script-load')!;
    expect((select.props as { value: string }).value).toBe('');
    (select.props as { onChange: (e: unknown) => void }).onChange({ target: { value: 'flyby' } });
    expect(onLoadSaved).toHaveBeenCalledWith('flyby');
    // Re-render: the controlled value must be '' again (not stuck on 'flyby'), so
    // selecting 'flyby' once more is a value change and re-fires onChange.
    tree = render({ ...base, onLoadSaved });
    select = findByTestId(tree, 'script-load')!;
    expect((select.props as { value: string }).value).toBe('');
  });

  it('keeps a delete target after a pick so Delete stays enabled', () => {
    states = [];
    const onDeleteSaved = vi.fn();
    let tree = render({ ...base, onDeleteSaved });
    const select = findByTestId(tree, 'script-load')!;
    (select.props as { onChange: (e: unknown) => void }).onChange({ target: { value: 'survey' } });
    tree = render({ ...base, onDeleteSaved });
    const del = findByTestId(tree, 'script-delete')!;
    expect((del.props as { disabled: boolean }).disabled).toBe(false);
    (del.props as { onClick: () => void }).onClick();
    expect(onDeleteSaved).toHaveBeenCalledWith('survey');
  });
});
