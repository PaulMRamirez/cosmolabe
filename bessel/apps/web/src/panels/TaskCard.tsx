// Phase 0 foundation primitives for the analysis-UX re-slot: an intent-named,
// collapsible TaskCard (title + one-line purpose + status chip + body), and a
// TaskCardAccordion that owns expand/collapse state and enforces the "at most two
// expanded" rule from the design (section 5, overload cap). Presentational only: no
// engine or store imports, so later phases mount these inside the domain tabs without
// coupling them to the state tree. The status chip reuses the runStatus semantics
// (idle/running/ok/error) and the RunStatusNote tag styling.

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Tag, Icon } from '@bessel/selene-design';
import type { RunStatus } from '../store/index.ts';

/** Maximum number of TaskCards a TaskCardAccordion keeps expanded at once. */
export const MAX_EXPANDED_TASK_CARDS = 2;

/** Cmd/Ctrl+Enter inside a card re-runs its primary Action, even from a focused input
 *  (so an analyst can tweak a parameter and re-run without reaching for the mouse). The
 *  primary Action button carries the bessel-card-action marker; trigger it if enabled. */
function rerunOnChord(ev: KeyboardEvent<HTMLDivElement>): void {
  if (ev.key !== 'Enter' || !(ev.metaKey || ev.ctrlKey)) return;
  const action = ev.currentTarget.querySelector<HTMLButtonElement>('.bessel-card-action');
  if (action && !action.disabled) {
    ev.preventDefault();
    action.click();
  }
}

/** A status chip derived from a tool's run status: nothing while idle, a "Running"
 *  amber tag, a green "Done" tag on success, or a red "Error" tag on a loud failure.
 *  Mirrors the RunStatusNote tones so a card header reads the same as a result note. */
function StatusChip(props: { status: RunStatus | undefined; id: string }): JSX.Element | null {
  const s = props.status;
  if (s == null || s === 'idle') return null;
  const testId = `taskcard-${props.id}-status`;
  if (s === 'running') {
    return (
      <span data-testid={testId} className="bessel-taskcard-status">
        <Tag tone="amber">Running</Tag>
      </span>
    );
  }
  if (s === 'ok') {
    return (
      <span data-testid={testId} className="bessel-taskcard-status">
        <Tag tone="green">Done</Tag>
      </span>
    );
  }
  return (
    <span data-testid={testId} className="bessel-taskcard-status" title={s.error}>
      <Tag tone="red">Error</Tag>
    </span>
  );
}

export interface TaskCardProps {
  /** Stable id, used for data-testids and accordion bookkeeping. */
  readonly id: string;
  /** The intent-named title (e.g. "Find ground-station passes"). */
  readonly title: string;
  /** A one-line purpose describing what the task answers. */
  readonly purpose: string;
  /** The owning tool's run status, rendered as a header chip (optional). */
  readonly status?: RunStatus;
  /** Whether the body is shown. Owned by the parent (the accordion). */
  readonly expanded: boolean;
  /** Toggle request from the header button. */
  readonly onToggle: () => void;
  /** An optional decorative concept icon shown before the title (a DomainIcon). */
  readonly icon?: ReactNode;
  /** The card body (config form, run, inline result), shown only when expanded. */
  readonly children: ReactNode;
}

/** A collapsible, intent-named analysis task card. The header is a real <button> with
 *  aria-expanded so the card is keyboard and screen-reader operable; the body renders
 *  only when expanded. Matches the PanelContainer look (header button + body region). */
export function TaskCard(props: TaskCardProps): JSX.Element {
  const regionId = `taskcard-${props.id}-body`;
  return (
    <section className="bessel-taskcard" data-testid={`taskcard-${props.id}`}>
      <h3 className="bessel-taskcard-header">
        <button
          type="button"
          className="bessel-taskcard-toggle"
          aria-expanded={props.expanded}
          aria-controls={regionId}
          data-testid={`taskcard-${props.id}-toggle`}
          onClick={props.onToggle}
        >
          <span className="bessel-taskcard-caret">
            <Icon name={props.expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
          </span>
          {props.icon ? (
            <span className="bessel-taskcard-icon" aria-hidden="true">{props.icon}</span>
          ) : null}
          <span className="bessel-taskcard-title">{props.title}</span>
          <span className="bessel-taskcard-purpose">{props.purpose}</span>
          <StatusChip status={props.status} id={props.id} />
        </button>
      </h3>
      <div
        id={regionId}
        className="bessel-taskcard-body"
        hidden={!props.expanded}
        onKeyDown={rerunOnChord}
      >
        {props.expanded ? props.children : null}
      </div>
    </section>
  );
}

/** One entry in a TaskCardAccordion: the card metadata plus a lazy body renderer so a
 *  collapsed card's body is not built until it expands. */
export interface TaskCardEntry {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly status?: RunStatus;
  /** An optional decorative concept icon shown before the title (a DomainIcon). */
  readonly icon?: ReactNode;
  /** Render the card body. Called only when the card is expanded. */
  readonly render: () => ReactNode;
}

/** Keep at most MAX_EXPANDED_TASK_CARDS ids, dropping the least-recently-expanded when
 *  a new id is added. `order` is most-recent-last. Exported for direct unit testing. */
export function nextExpanded(order: readonly string[], id: string): string[] {
  if (order.includes(id)) return order.filter((x) => x !== id);
  const grown = [...order, id];
  return grown.slice(Math.max(0, grown.length - MAX_EXPANDED_TASK_CARDS));
}

/** A request to expand one or more cards, raised from outside the accordion (e.g. the
 *  AnalysisLauncher's single hit, or a mission-profile preset's primary cards). `id` is a
 *  single card id or an ordered list (applied left-to-right through the cap reducer, so the
 *  last id wins a tie under the at-most-two-expanded rule). The `token` lets the same
 *  request be re-fired: a changed token re-triggers the expand even when the ids repeat. */
export interface ExpandRequest {
  readonly id: string | readonly string[];
  readonly token: number;
}

export interface TaskCardAccordionProps {
  readonly cards: readonly TaskCardEntry[];
  /** Ids expanded on first render; capped to MAX_EXPANDED_TASK_CARDS (most-recent-last). */
  readonly defaultExpanded?: readonly string[];
  /** An external request to expand a card (its id must match a card); honored on change. */
  readonly expandRequest?: ExpandRequest;
}

/** A container that renders TaskCards and owns which are expanded, enforcing the
 *  at-most-two-expanded cap: expanding a third card collapses the least-recently
 *  expanded one. State is local (useState); no store coupling. An external expandRequest
 *  (from the launcher) opens a named card through the same cap reducer. */
export function TaskCardAccordion(props: TaskCardAccordionProps): JSX.Element {
  const [order, setOrder] = useState<readonly string[]>(() =>
    (props.defaultExpanded ?? []).slice(-MAX_EXPANDED_TASK_CARDS),
  );
  // The explicit "expand all" escape hatch from the cap. When true, every card is
  // expanded and the at-most-two cap is bypassed; the user asked for all of them, so
  // honor it. Any individual toggle (below) drops back to the normal capped LRU.
  const [expandAll, setExpandAll] = useState(false);
  const req = props.expandRequest;
  // Normalize the request to an ordered list of ids that actually exist as cards here.
  const cardIds = props.cards.map((c) => c.id);
  const reqIds = req
    ? (Array.isArray(req.id) ? req.id : [req.id]).filter((id) => cardIds.includes(id))
    : [];
  const reqKey = reqIds.join(',');
  const reqToken = req?.token;
  useEffect(() => {
    // reqToken is the change signal; reqKey carries the (filtered) target ids. A single-id
    // request (the launcher's one hit) is additive: it opens that card through the cap reducer
    // without disturbing the others. A multi-id request (a mission-profile preset's primary
    // cards) opens exactly those ids as a fresh capped set, most-recent-last, so the persona's
    // chosen cards are the ones expanded rather than racing the panel's defaultExpanded.
    if (reqKey.length === 0) return;
    const ids = reqKey.split(',');
    // An external request targets specific cards through the capped reducer, so it leaves
    // the explicit expand-all mode (a request is not "show everything").
    setExpandAll(false);
    setOrder((o) =>
      ids.length > 1
        ? ids.slice(Math.max(0, ids.length - MAX_EXPANDED_TASK_CARDS))
        : ids.reduce((acc, id) => (acc.includes(id) ? acc : nextExpanded(acc, id)), o),
    );
  }, [reqToken, reqKey]);
  // While expand-all is active every card is open; otherwise the normal capped order wins.
  const expanded = expandAll ? new Set(cardIds) : new Set(order);
  // The cap can silently collapse cards once there are more than the cap, so the
  // expand/collapse-all control is only a discoverable escape hatch when that can happen.
  const overCap = props.cards.length > MAX_EXPANDED_TASK_CARDS;
  // Individual toggles return to the normal LRU: turn off expand-all, and when leaving
  // expand-all collapse to this single card so we never strand more than the cap open.
  const toggleCard = (id: string): void => {
    if (expandAll) {
      setExpandAll(false);
      setOrder([id]);
      return;
    }
    setOrder((o) => nextExpanded(o, id));
  };
  return (
    <div className="bessel-taskcard-accordion" data-testid="taskcard-accordion">
      {overCap ? (
        <div className="bessel-taskcard-accordion-controls">
          {expandAll ? (
            <button
              type="button"
              className="bessel-taskcard-accordion-toggle-all"
              data-testid="accordion-collapse-all"
              onClick={() => {
                setExpandAll(false);
                setOrder([]);
              }}
            >
              Collapse all
            </button>
          ) : (
            <button
              type="button"
              className="bessel-taskcard-accordion-toggle-all"
              data-testid="accordion-expand-all"
              onClick={() => setExpandAll(true)}
            >
              Expand all
            </button>
          )}
        </div>
      ) : null}
      {props.cards.map((card) => {
        const isOpen = expanded.has(card.id);
        return (
          <TaskCard
            key={card.id}
            id={card.id}
            title={card.title}
            purpose={card.purpose}
            {...(card.status !== undefined ? { status: card.status } : {})}
            {...(card.icon !== undefined ? { icon: card.icon } : {})}
            expanded={isOpen}
            onToggle={() => toggleCard(card.id)}
          >
            {isOpen ? card.render() : null}
          </TaskCard>
        );
      })}
    </div>
  );
}
