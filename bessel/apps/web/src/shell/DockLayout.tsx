// Resizable three-column dock: a left object panel, the center viewport stage,
// and a right tools panel, with draggable splitters (react-resizable-panels). On
// narrow viewports it collapses to a slide-in drawer (B23): the viewport takes the
// full width and the panels live in an off-canvas drawer toggled by a button, so the
// controls stay reachable on phones without crowding the scene.

import { useState, type ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery, NARROW_MEDIA_QUERY } from './use-media-query.ts';

export interface DockLayoutProps {
  readonly left: ReactNode;
  readonly center: ReactNode;
  /** Optional right tools column. When omitted the canvas takes the freed width. */
  readonly right?: ReactNode;
}

function NarrowDock(props: DockLayoutProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="bessel-dock bessel-dock-narrow">
      <div className="bessel-dock-center">{props.center}</div>
      <button
        type="button"
        className="bessel-drawer-toggle"
        aria-expanded={open}
        aria-controls="bessel-panel-drawer"
        onClick={() => setOpen((v) => !v)}
        data-testid="panels-drawer-toggle"
      >
        {open ? 'Close panels' : 'Panels'}
      </button>
      {open ? (
        <div
          className="bessel-drawer-backdrop"
          data-testid="drawer-backdrop"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="bessel-panel-drawer"
        className={`bessel-dock-drawer${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        data-testid="panel-drawer"
      >
        {props.left}
        {props.right}
      </aside>
    </div>
  );
}

export function DockLayout(props: DockLayoutProps): JSX.Element {
  const narrow = useMediaQuery(NARROW_MEDIA_QUERY);

  if (narrow) return <NarrowDock {...props} />;

  // react-resizable-panels reads defaultSize only at mount, then renormalizes the last
  // sizes on layout changes. Toggling the right column off would otherwise keep the old
  // 20/56 split (the freed width is not reclaimed). Keying the group by the right
  // column's presence remounts it so the canvas takes the full 20/80 default.
  return (
    <PanelGroup
      key={props.right ? 'with-right' : 'no-right'}
      direction="horizontal"
      className="bessel-dock"
    >
      <Panel order={1} defaultSize={20} minSize={12} className="bessel-dock-side">
        {props.left}
      </Panel>
      <PanelResizeHandle className="bessel-resize-handle" aria-label="Resize object panel" />
      <Panel order={2} defaultSize={props.right ? 56 : 80} minSize={30} className="bessel-dock-center">
        {props.center}
      </Panel>
      {props.right ? (
        <>
          <PanelResizeHandle className="bessel-resize-handle" aria-label="Resize tools panel" />
          <Panel order={3} defaultSize={24} minSize={14} className="bessel-dock-side">
            {props.right}
          </Panel>
        </>
      ) : null}
    </PanelGroup>
  );
}
