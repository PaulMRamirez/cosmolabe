import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AppBar } from './AppBar.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { PanelContainer } from './PanelContainer.tsx';
import { Tooltip } from './Tooltip.tsx';
import { SearchBox } from './SearchBox.tsx';
import { ObjectInspector } from './ObjectInspector.tsx';
import { MeasurePanel, formatSpeed } from './MeasurePanel.tsx';
import { BookmarksPanel } from './BookmarksPanel.tsx';
import { ScriptConsole } from './ScriptConsole.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('@bessel/ui AppBar', () => {
  it('renders the brand heading and an actions slot', () => {
    const out = html(
      createElement(
        AppBar,
        { title: 'Bessel', subtitle: 'Cassini at Saturn' },
        createElement('button', { type: 'button' }, 'Action'),
      ),
    );
    expect(out).toContain('<h1>Bessel</h1>');
    expect(out).toContain('Cassini at Saturn');
    expect(out).toContain('bessel-appbar-actions');
  });
});

describe('@bessel/ui ThemeToggle', () => {
  it('labels the switch by the theme it activates', () => {
    expect(html(createElement(ThemeToggle, { theme: 'dark', onToggle: () => {} }))).toContain(
      'aria-label="Switch to light theme"',
    );
    expect(html(createElement(ThemeToggle, { theme: 'light', onToggle: () => {} }))).toContain(
      'aria-label="Switch to dark theme"',
    );
  });
});

describe('@bessel/ui PanelContainer', () => {
  it('exposes an expanded toggle controlling a region', () => {
    const out = html(
      createElement(PanelContainer, { title: 'Objects', testId: 'panel-objects', children: 'body' }),
    );
    expect(out).toContain('data-testid="panel-objects"');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-controls=');
    expect(out).toContain('Objects');
  });

  it('starts collapsed when asked', () => {
    const out = html(
      createElement(PanelContainer, { title: 'Capture', defaultCollapsed: true, children: 'body' }),
    );
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('hidden=');
  });
});

describe('@bessel/ui Tooltip', () => {
  it('associates the label with the child via aria-describedby', () => {
    const out = html(
      createElement(Tooltip, {
        label: 'Toggle theme',
        children: createElement('button', { type: 'button' }, 'x'),
      }),
    );
    expect(out).toContain('role="tooltip"');
    expect(out).toContain('aria-describedby=');
    expect(out).toContain('Toggle theme');
  });
});

describe('@bessel/ui SearchBox', () => {
  it('renders a labelled search input', () => {
    const out = html(createElement(SearchBox, { value: '', onChange: () => {}, label: 'Find' }));
    expect(out).toContain('type="search"');
    expect(out).toContain('data-testid="search-box"');
    expect(out).toContain('Find');
  });
});

describe('@bessel/ui ObjectInspector', () => {
  it('shows the empty message when nothing is selected', () => {
    const out = html(createElement(ObjectInspector, { name: null, fields: [] }));
    expect(out).toContain('No object selected');
  });

  it('renders the name, kind, and fields when populated', () => {
    const out = html(
      createElement(ObjectInspector, {
        name: 'Saturn',
        kind: 'body',
        fields: [{ label: 'SPICE id', value: '699' }],
      }),
    );
    expect(out).toContain('data-testid="inspector-name"');
    expect(out).toContain('Saturn');
    expect(out).toContain('SPICE id');
    expect(out).toContain('699');
  });
});

describe('@bessel/ui MeasurePanel', () => {
  it('prompts when fewer than two objects are selected', () => {
    const out = html(createElement(MeasurePanel, { from: null, to: null, distanceKm: null }));
    expect(out).toContain('Select two objects to measure');
  });

  it('formats the distance with commas and an AU value when large', () => {
    const out = html(
      createElement(MeasurePanel, {
        from: 'Saturn',
        to: 'Earth',
        distanceKm: 1_500_000_000,
        angleDeg: 12.345,
      }),
    );
    expect(out).toContain('data-testid="measure-distance"');
    expect(out).toContain('1,500,000,000 km');
    expect(out).toContain('AU');
    expect(out).toContain('Saturn');
    expect(out).toContain('data-testid="measure-angle"');
    expect(out).toContain('12.35 deg');
  });

  it('shows the Measure-mode toggle and mode-aware guidance', () => {
    const out = html(
      createElement(MeasurePanel, {
        from: null,
        to: null,
        distanceKm: null,
        measureMode: true,
        onToggleMode: () => undefined,
      }),
    );
    expect(out).toContain('Measure mode: click two objects in the view');
    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-testid="measure-mode"/);
  });

  it('labels the range-rate trend, with a neutral "steady" at (and near) zero', () => {
    // A real closing/separating rate keeps its trend word.
    expect(formatSpeed(-1.25)).toBe('1.250 km/s closing');
    expect(formatSpeed(1.25)).toBe('1.250 km/s separating');
    // Exactly zero (and sub-epsilon) must not read as "separating".
    expect(formatSpeed(0)).toBe('0.000 km/s steady');
    expect(formatSpeed(1e-9)).toBe('0.000 km/s steady');
  });

  it('offers Clear only when there is a selection', () => {
    const withSel = html(
      createElement(MeasurePanel, {
        from: null,
        to: null,
        distanceKm: null,
        onClear: () => undefined,
        hasSelection: true,
      }),
    );
    expect(withSel).toContain('data-testid="measure-clear"');
    const noSel = html(
      createElement(MeasurePanel, {
        from: null,
        to: null,
        distanceKm: null,
        onClear: () => undefined,
        hasSelection: false,
      }),
    );
    expect(noSel).not.toContain('data-testid="measure-clear"');
  });
});

describe('@bessel/ui ScriptConsole', () => {
  const noop = (): void => undefined;
  const base = {
    source: 'gotoObject Earth',
    onChange: noop,
    onRun: noop,
    log: ['1: gotoObject Earth'],
    onClearLog: noop,
    verbs: [
      { verb: 'gotoObject', arity: 1 },
      { verb: 'pause', arity: 0 },
    ],
    savedScriptNames: ['flyby', 'survey'],
    onSave: noop,
    onLoadSaved: noop,
    onDeleteSaved: noop,
  };

  it('renders the editor, run/clear actions, save/load controls, and the verb reference', () => {
    const out = html(createElement(ScriptConsole, base));
    expect(out).toContain('data-testid="script-input"');
    expect(out).toContain('data-testid="script-run"');
    expect(out).toContain('data-testid="script-clear-log"');
    expect(out).toContain('data-testid="script-save"');
    expect(out).toContain('data-testid="script-load"');
    expect(out).toContain('data-testid="script-verbs"');
    // The saved names appear as load options and the verbs in the reference list.
    expect(out).toContain('flyby');
    expect(out).toContain('survey');
    expect(out).toContain('gotoObject');
    expect(out).toContain('Verb reference (2)');
  });

  it('disables Save with an empty name field by default', () => {
    const out = html(createElement(ScriptConsole, base));
    expect(out).toMatch(/<button[^>]*\bdisabled\b[^>]*data-testid="script-save"/);
  });
});

describe('@bessel/ui BookmarksPanel', () => {
  const noop = (): void => undefined;

  it('shows an empty state with no bookmarks', () => {
    const out = html(
      createElement(BookmarksPanel, {
        bookmarks: [],
        onSave: noop,
        onApply: noop,
        onDelete: noop,
      }),
    );
    expect(out).toContain('No saved views yet');
    expect(out).toContain('data-testid="bookmark-save"');
  });

  it('lists each bookmark with an apply and a delete control', () => {
    const out = html(
      createElement(BookmarksPanel, {
        bookmarks: [{ id: 'a', name: 'Earth view', hash: 'cam=center:Earth' }],
        onSave: noop,
        onApply: noop,
        onDelete: noop,
      }),
    );
    expect(out).toContain('data-testid="bookmarks-list"');
    expect(out).toContain('Earth view');
    expect(out).toContain('aria-label="Delete Earth view"');
  });

  it('renders copy-link, export, and import controls when wired, and a loud import error', () => {
    const out = html(
      createElement(BookmarksPanel, {
        bookmarks: [{ id: 'a', name: 'Earth view', hash: 'cam=center:Earth' }],
        onSave: noop,
        onApply: noop,
        onDelete: noop,
        onCopyLink: noop,
        onExport: noop,
        onImport: noop,
        importError: 'Bookmark import: not valid JSON',
      }),
    );
    expect(out).toContain('data-testid="bookmark-copy-a"');
    expect(out).toContain('data-testid="bookmarks-export"');
    expect(out).toContain('data-testid="bookmarks-import"');
    expect(out).toMatch(/role="alert"[^>]*data-testid="bookmark-import-error"/);
    expect(out).toContain('Bookmark import: not valid JSON');
  });

  it('disables export when there are no saved views', () => {
    const out = html(
      createElement(BookmarksPanel, {
        bookmarks: [],
        onSave: noop,
        onApply: noop,
        onDelete: noop,
        onExport: noop,
      }),
    );
    expect(out).toMatch(/disabled[^>]*data-testid="bookmarks-export"|data-testid="bookmarks-export"[^>]*disabled/);
  });
});
