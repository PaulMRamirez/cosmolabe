import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  TaskCard,
  TaskCardAccordion,
  nextExpanded,
  MAX_EXPANDED_TASK_CARDS,
  type TaskCardEntry,
} from './TaskCard.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

const card = (props: Partial<Parameters<typeof TaskCard>[0]> = {}): JSX.Element =>
  createElement(TaskCard, {
    id: 'passes',
    title: 'Find passes',
    purpose: 'Station visibility windows',
    expanded: true,
    onToggle: () => undefined,
    children: createElement('p', { 'data-testid': 'body' }, 'body content'),
    ...props,
  });

describe('TaskCard', () => {
  it('renders the title, purpose, and stable testids', () => {
    const out = html(card());
    expect(out).toContain('data-testid="taskcard-passes"');
    expect(out).toContain('data-testid="taskcard-passes-toggle"');
    expect(out).toContain('Find passes');
    expect(out).toContain('Station visibility windows');
  });

  it('uses a real toggle button reflecting expanded via aria-expanded', () => {
    expect(html(card({ expanded: true }))).toMatch(/<button[^>]*aria-expanded="true"/);
    expect(html(card({ expanded: false }))).toMatch(/<button[^>]*aria-expanded="false"/);
  });

  it('shows the body only when expanded', () => {
    expect(html(card({ expanded: true }))).toContain('body content');
    const collapsed = html(card({ expanded: false }));
    expect(collapsed).not.toContain('body content');
    expect(collapsed).toMatch(/class="bessel-taskcard-body"[^>]*hidden/);
  });

  it('derives a status chip from the run status (running/ok/error), none when idle', () => {
    expect(html(card({ status: 'running' }))).toContain('Running');
    expect(html(card({ status: 'ok' }))).toContain('Done');
    const err = html(card({ status: { error: 'no frame' } }));
    expect(err).toContain('Error');
    expect(err).toContain('data-testid="taskcard-passes-status"');
    expect(html(card({ status: 'idle' }))).not.toContain('taskcard-passes-status');
  });
});

describe('nextExpanded (accordion cap reducer)', () => {
  it('toggles an open id closed', () => {
    expect(nextExpanded(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('never keeps more than the cap, dropping the least-recently expanded', () => {
    expect(MAX_EXPANDED_TASK_CARDS).toBe(2);
    let order: string[] = [];
    order = nextExpanded(order, 'a');
    order = nextExpanded(order, 'b');
    expect(order).toEqual(['a', 'b']);
    order = nextExpanded(order, 'c');
    expect(order).toEqual(['b', 'c']);
    expect(order.length).toBeLessThanOrEqual(MAX_EXPANDED_TASK_CARDS);
  });
});

describe('TaskCardAccordion', () => {
  const entries: readonly TaskCardEntry[] = [
    { id: 'one', title: 'One', purpose: 'first', render: () => createElement('p', null, 'body-one') },
    { id: 'two', title: 'Two', purpose: 'second', render: () => createElement('p', null, 'body-two') },
    { id: 'three', title: 'Three', purpose: 'third', render: () => createElement('p', null, 'body-three') },
  ];

  it('renders one TaskCard per entry under the accordion container', () => {
    const out = html(createElement(TaskCardAccordion, { cards: entries }));
    expect(out).toContain('data-testid="taskcard-accordion"');
    for (const id of ['one', 'two', 'three']) {
      expect(out).toContain(`data-testid="taskcard-${id}"`);
    }
  });

  it('expands only the defaultExpanded ids and renders only their bodies', () => {
    const out = html(createElement(TaskCardAccordion, { cards: entries, defaultExpanded: ['one'] }));
    expect(out).toContain('body-one');
    expect(out).not.toContain('body-two');
    expect(out).not.toContain('body-three');
  });

  it('never shows more than the cap on first render, keeping the most recent ids', () => {
    const out = html(
      createElement(TaskCardAccordion, { cards: entries, defaultExpanded: ['one', 'two', 'three'] }),
    );
    // Capped to the last two ids; the first is dropped, its body not rendered.
    expect(out).not.toContain('body-one');
    expect(out).toContain('body-two');
    expect(out).toContain('body-three');
    const open = (out.match(/aria-expanded="true"/g) ?? []).length;
    expect(open).toBeLessThanOrEqual(MAX_EXPANDED_TASK_CARDS);
  });

  it('shows the Expand all control only when there are more cards than the cap', () => {
    // Three cards (> the cap of two): the discoverable escape hatch is offered.
    const over = html(createElement(TaskCardAccordion, { cards: entries }));
    expect(over).toContain('data-testid="accordion-expand-all"');
    expect(over).toContain('Expand all');
    // Two cards (at the cap): the cap can never silently collapse, so no control.
    const atCap = html(createElement(TaskCardAccordion, { cards: entries.slice(0, 2) }));
    expect(atCap).not.toContain('accordion-expand-all');
    expect(atCap).not.toContain('accordion-collapse-all');
  });
});
