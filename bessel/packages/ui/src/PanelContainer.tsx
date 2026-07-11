// A titled, collapsible panel wrapper used to dock the viewer's controls. The
// header is a button that toggles a region (aria-expanded / aria-controls) so
// the panel is keyboard and screen-reader operable.

import { useId, useState, type ReactNode } from 'react';

export interface PanelContainerProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultCollapsed?: boolean;
  readonly testId?: string;
}

export function PanelContainer(props: PanelContainerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);
  const regionId = useId();
  return (
    <section className="bessel-panel" data-testid={props.testId}>
      <h2 className="bessel-panel-header">
        <button
          type="button"
          className="bessel-panel-toggle"
          aria-expanded={!collapsed}
          aria-controls={regionId}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="bessel-panel-caret" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          {props.title}
        </button>
      </h2>
      <div id={regionId} className="bessel-panel-body" hidden={collapsed}>
        {props.children}
      </div>
    </section>
  );
}
