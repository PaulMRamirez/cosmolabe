// Accessible tooltip: wraps a single focusable element and associates a
// descriptive label via aria-describedby. The label is shown on hover and focus
// (CSS), and is always available to assistive tech through the description.

import { cloneElement, useId, type ReactElement } from 'react';

export interface TooltipProps {
  readonly label: string;
  /** A single focusable element; it receives aria-describedby pointing at the label. */
  readonly children: ReactElement;
}

export function Tooltip(props: TooltipProps): JSX.Element {
  const id = useId();
  return (
    <span className="bessel-tooltip-wrap">
      {cloneElement(props.children, { 'aria-describedby': id } as Partial<unknown>)}
      <span role="tooltip" id={id} className="bessel-tooltip">
        {props.label}
      </span>
    </span>
  );
}
