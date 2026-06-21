// Catalog loader: a button (hidden file input) plus a drop target for loading a
// Cosmographia or native catalog file. Presentational: it reads the file text and
// hands it to onLoad; the app does the parsing and validation. Errors are shown
// in a live region so they are announced.

import { useRef, useState, type DragEvent } from 'react';

export interface CatalogSample {
  readonly label: string;
  readonly url: string;
}

export interface CatalogLoaderProps {
  readonly onLoad: (file: { name: string; text: string }) => void;
  readonly status?: string | null;
  readonly error?: string | null;
  /** Bundled sample missions offered as one-click loads (e.g. Cassini at Saturn). */
  readonly samples?: readonly CatalogSample[];
  readonly onLoadSample?: (url: string) => void;
  /** When set, render a text field to load a catalog from an arbitrary URL. */
  readonly onLoadUrl?: (url: string) => void;
}

export function CatalogLoader(props: CatalogLoaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');

  const read = (file: File): void => {
    void file.text().then((text) => props.onLoad({ name: file.name, text }));
  };

  const onDrop = (ev: DragEvent<HTMLDivElement>): void => {
    ev.preventDefault();
    setDragOver(false);
    const file = ev.dataTransfer.files.item(0);
    if (file) read(file);
  };

  return (
    <div
      className={dragOver ? 'bessel-catalog-loader is-dragover' : 'bessel-catalog-loader'}
      onDragOver={(ev) => {
        ev.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-testid="catalog-loader"
    >
      <button type="button" onClick={() => inputRef.current?.click()} data-testid="load-catalog">
        Load catalog
      </button>
      <span className="bessel-loader-hint">or drop a file</span>
      {props.samples?.map((sample) => (
        <button
          key={sample.url}
          type="button"
          className="bessel-loader-sample"
          onClick={() => props.onLoadSample?.(sample.url)}
          data-testid={`load-sample-${sample.url.split('/').pop()}`}
        >
          {sample.label}
        </button>
      ))}
      {props.onLoadUrl ? (
        <form
          className="bessel-loader-url"
          onSubmit={(ev) => {
            ev.preventDefault();
            const u = url.trim();
            if (!u) return;
            props.onLoadUrl?.(u);
            setUrl('');
          }}
        >
          <input
            type="url"
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            placeholder="https://.../catalog.json"
            aria-label="Catalog URL"
            data-testid="load-url-input"
          />
          <button type="submit" data-testid="load-url-submit">
            Load URL
          </button>
        </form>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="bessel-visually-hidden"
        aria-label="Catalog file"
        data-testid="catalog-file-input"
        onChange={(ev) => {
          const file = ev.target.files?.item(0);
          if (file) read(file);
          ev.target.value = '';
        }}
      />
      <div role="status" className="bessel-loader-status">
        {props.error ? null : props.status}
      </div>
      <div role="alert" className="bessel-loader-error" data-testid="load-error">
        {props.error}
      </div>
    </div>
  );
}
