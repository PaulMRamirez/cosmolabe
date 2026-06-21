import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { RunStatusNote, busyLabel } from './RunStatus.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('busyLabel', () => {
  it('disables and swaps the label only while running', () => {
    expect(busyLabel('running', 'Run', 'Computing...')).toEqual({ label: 'Computing...', disabled: true });
    expect(busyLabel('ok', 'Run', 'Computing...')).toEqual({ label: 'Run', disabled: false });
    expect(busyLabel(undefined, 'Run', 'Computing...')).toEqual({ label: 'Run', disabled: false });
  });
});

describe('RunStatusNote', () => {
  it('renders nothing while idle or running', () => {
    expect(html(createElement(RunStatusNote, { status: undefined, id: 'compute-range' }))).toBe('');
    expect(html(createElement(RunStatusNote, { status: 'running', id: 'compute-range' }))).toBe('');
  });

  it('renders a Done tag on success', () => {
    const out = html(createElement(RunStatusNote, { status: 'ok', id: 'compute-range' }));
    expect(out).toContain('data-testid="compute-range-status"');
    expect(out).toContain('Done');
  });

  it('renders a Failed tag and a loud located error on failure', () => {
    const out = html(
      createElement(RunStatusNote, { status: { error: 'no spacecraft frame' }, id: 'compute-range' }),
    );
    expect(out).toContain('Failed');
    expect(out).toMatch(/role="alert"[^>]*data-testid="compute-range-error"/);
    expect(out).toContain('no spacecraft frame');
  });
});
