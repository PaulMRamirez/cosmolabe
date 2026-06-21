// Saved views panel: name and save the current view, then apply or delete saved
// ones. Presentational; the engine encodes and persists the views.

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

export interface BookmarkItem {
  readonly id: string;
  readonly name: string;
  /** The encoded view hash, used to build a per-view shareable link. */
  readonly hash: string;
}

export interface BookmarksPanelProps {
  readonly bookmarks: readonly BookmarkItem[];
  readonly onSave: (name: string) => void;
  readonly onApply: (id: string) => void;
  readonly onDelete: (id: string) => void;
  /** Copy a shareable link to a single saved view. */
  readonly onCopyLink?: (id: string) => void;
  /** Export the whole saved-views list as JSON. */
  readonly onExport?: () => void;
  /** Import a saved-views JSON document (merged with the current list). */
  readonly onImport?: (json: string) => void;
  /** A loud import error to surface, or null. */
  readonly importError?: string | null;
}

export function BookmarksPanel(props: BookmarksPanelProps): JSX.Element {
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (ev: FormEvent): void => {
    ev.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    props.onSave(trimmed);
    setName('');
  };

  const onFile = (ev: ChangeEvent<HTMLInputElement>): void => {
    const file = ev.target.files?.item(0);
    if (file) void file.text().then((text) => props.onImport?.(text));
    ev.target.value = '';
  };

  return (
    <div className="bessel-bookmarks" data-testid="bookmarks">
      <form className="bessel-bookmark-form" onSubmit={submit}>
        <input
          className="bessel-bookmark-input"
          value={name}
          onChange={(ev) => setName(ev.target.value)}
          placeholder="Name this view"
          aria-label="Bookmark name"
          data-testid="bookmark-name"
        />
        <button type="submit" disabled={name.trim() === ''} data-testid="bookmark-save">
          Save view
        </button>
      </form>
      {props.bookmarks.length === 0 ? (
        <p className="bessel-bookmarks-empty">No saved views yet</p>
      ) : (
        <ul className="bessel-bookmarks-list" data-testid="bookmarks-list">
          {props.bookmarks.map((b) => (
            <li key={b.id} className="bessel-bookmark-row">
              <button
                type="button"
                className="bessel-bookmark-apply"
                onClick={() => props.onApply(b.id)}
              >
                {b.name}
              </button>
              {props.onCopyLink ? (
                <button
                  type="button"
                  className="bessel-bookmark-copy"
                  aria-label={`Copy link to ${b.name}`}
                  data-testid={`bookmark-copy-${b.id}`}
                  onClick={() => props.onCopyLink?.(b.id)}
                >
                  Copy link
                </button>
              ) : null}
              <button
                type="button"
                className="bessel-bookmark-delete"
                aria-label={`Delete ${b.name}`}
                onClick={() => props.onDelete(b.id)}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.onExport || props.onImport ? (
        <div className="bessel-bookmark-tools" role="group" aria-label="Saved views import and export">
          {props.onExport ? (
            <button
              type="button"
              data-testid="bookmarks-export"
              disabled={props.bookmarks.length === 0}
              onClick={props.onExport}
            >
              Export JSON
            </button>
          ) : null}
          {props.onImport ? (
            <>
              <button
                type="button"
                data-testid="bookmarks-import"
                onClick={() => fileRef.current?.click()}
              >
                Import JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="bessel-visually-hidden"
                tabIndex={-1}
                aria-label="Saved views file"
                onChange={onFile}
                data-testid="bookmarks-import-file"
              />
            </>
          ) : null}
        </div>
      ) : null}
      {props.importError ? (
        <p className="bessel-bookmarks-error" role="alert" data-testid="bookmark-import-error">
          {props.importError}
        </p>
      ) : null}
    </div>
  );
}
