// Labeled search input for filtering objects. Presentational and controlled; the
// viewer owns the query string and the filtering.

import { useId } from 'react';

export interface SearchBoxProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly placeholder?: string;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const id = useId();
  const label = props.label ?? 'Search objects';
  return (
    <div className="bessel-searchbox">
      <label htmlFor={id} className="bessel-visually-hidden">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className="bessel-searchbox-input"
        value={props.value}
        placeholder={props.placeholder ?? label}
        onChange={(e) => props.onChange(e.target.value)}
        data-testid="search-box"
      />
    </div>
  );
}
