// Application bar: the top landmark with the product brand and a slot for
// actions (search, load, theme toggle). Presentational; the shell composes it.

import type { ReactNode } from 'react';

export interface AppBarProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Action controls rendered at the trailing edge. */
  readonly children?: ReactNode;
}

export function AppBar(props: AppBarProps): JSX.Element {
  return (
    <header className="bessel-appbar" data-testid="app-bar">
      <div className="bessel-appbar-brand">
        <h1>{props.title}</h1>
        {props.subtitle ? <span className="bessel-appbar-subtitle">{props.subtitle}</span> : null}
      </div>
      {props.children ? <div className="bessel-appbar-actions">{props.children}</div> : null}
    </header>
  );
}
