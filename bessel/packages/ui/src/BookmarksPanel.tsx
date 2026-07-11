// Saved views panel: name and save the current view, then apply or delete saved
// ones. Presentational; the engine encodes and persists the views.

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '@bessel/selene-design';

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

  const submit = (ev?: FormEvent): void => {
    ev?.preventDefault();
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
        <Button
          variant="primary"
          onClick={() => submit()}
          disabled={name.trim() === ''}
          testId="bookmark-save"
        >
          Save view
        </Button>
      </form>
      {props.bookmarks.length === 0 ? (
        <p className="bessel-bookmarks-empty">No saved views yet</p>
      ) : (
        <ul className="bessel-bookmarks-list" data-testid="bookmarks-list">
          {props.bookmarks.map((b) => (
            <li key={b.id} className="bessel-bookmark-row">
              <Button
                variant="ghost"
                className="bessel-bookmark-apply"
                onClick={() => props.onApply(b.id)}
              >
                {b.name}
              </Button>
              {props.onCopyLink ? (
                <Button
                  variant="secondary"
                  className="bessel-bookmark-copy"
                  ariaLabel={`Copy link to ${b.name}`}
                  testId={`bookmark-copy-${b.id}`}
                  onClick={() => props.onCopyLink?.(b.id)}
                >
                  Copy link
                </Button>
              ) : null}
              <Button
                variant="ghost"
                className="bessel-bookmark-delete"
                ariaLabel={`Delete ${b.name}`}
                onClick={() => props.onDelete(b.id)}
              >
                <span aria-hidden="true">✕</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {props.onExport || props.onImport ? (
        <div className="bessel-bookmark-tools" role="group" aria-label="Saved views import and export">
          {props.onExport ? (
            <Button
              variant="secondary"
              testId="bookmarks-export"
              disabled={props.bookmarks.length === 0}
              onClick={props.onExport}
            >
              Export JSON
            </Button>
          ) : null}
          {props.onImport ? (
            <>
              <Button
                variant="secondary"
                testId="bookmarks-import"
                onClick={() => fileRef.current?.click()}
              >
                Import JSON
              </Button>
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
