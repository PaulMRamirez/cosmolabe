// The application chrome: the top app bar plus the dock. It composes the brand,
// the action slot (theme toggle, future load/search), the three dock regions, and
// the full-width bottom bar (timeline). Purely structural; the viewer supplies
// the slot content.

import type { ReactNode } from 'react';
import { AppBar } from '@bessel/ui';
import { DockLayout } from './DockLayout.tsx';

export interface AppShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly left: ReactNode;
  readonly center: ReactNode;
  readonly right?: ReactNode;
  readonly bottom: ReactNode;
}

export function AppShell(props: AppShellProps): JSX.Element {
  return (
    <div className="bessel-shell">
      <AppBar title={props.title} subtitle={props.subtitle}>
        {props.actions}
      </AppBar>
      <main className="bessel-main">
        <DockLayout left={props.left} center={props.center} right={props.right} />
        <div className="bessel-bottombar">{props.bottom}</div>
      </main>
    </div>
  );
}
