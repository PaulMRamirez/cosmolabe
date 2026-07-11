// Scripting console: a small in-app editor that runs Cosmographia-style
// cosmoscripting verbs against the live viewer. Presentational only: the app
// owns the source string, holds the executed-verb log, persists named scripts,
// and wires the callbacks to the line interpreter and PAL Storage. The textarea
// and controls are labeled so the axe a11y scan passes.

import { useRef, useState } from 'react';

/** Cap on the recalled-source ring buffer; older submissions fall off the back. */
const HISTORY_LIMIT = 50;

export interface ScriptConsoleProps {
  /** The current script source (one `verb arg...` per line; `#` comments). */
  readonly source: string;
  readonly onChange: (source: string) => void;
  readonly onRun: () => void;
  /** Executed-verb echo plus any per-line error, accumulated across runs. */
  readonly log: readonly string[];
  readonly onClearLog: () => void;
  /** Accepted verbs with their argument counts, for the inline reference. */
  readonly verbs: readonly { readonly verb: string; readonly arity: number }[];
  /** Names of the persisted scripts, for the load/delete menu. */
  readonly savedScriptNames: readonly string[];
  readonly onSave: (name: string) => void;
  readonly onLoadSaved: (name: string) => void;
  readonly onDeleteSaved: (name: string) => void;
}

const PLACEHOLDER = ['gotoObject Earth', 'setTimeRate 3600', 'show orbits', '# unpause the clock', 'unpause'].join(
  '\n',
);

export function ScriptConsole(props: ScriptConsoleProps): JSX.Element {
  const [name, setName] = useState('');

  // Command-history ring buffer of SUBMITTED sources (oldest first, newest last),
  // recalled in the editor with ArrowUp/ArrowDown. The cursor walks the buffer:
  // null means "editing the live draft", and stepping past the newest entry
  // restores that draft (saved on the first recall step).
  const [history, setHistory] = useState<readonly string[]>([]);
  const cursor = useRef<number | null>(null);
  const draft = useRef('');

  const run = (): void => {
    const submitted = props.source;
    setHistory((prev) =>
      prev.length > 0 && prev[prev.length - 1] === submitted
        ? prev // dedup consecutive duplicates
        : [...prev, submitted].slice(-HISTORY_LIMIT),
    );
    cursor.current = null;
    props.onRun();
  };

  const recall = (delta: -1 | 1): void => {
    if (history.length === 0) return;
    if (cursor.current === null) {
      if (delta === 1) return; // already on the live draft; nothing newer to show
      draft.current = props.source;
      cursor.current = history.length - 1;
    } else {
      const next = cursor.current + delta;
      if (next < 0) return; // hold at the oldest entry
      if (next >= history.length) {
        cursor.current = null; // stepped past the newest: back to the in-progress draft
        props.onChange(draft.current);
        return;
      }
      cursor.current = next;
    }
    const entry = history[cursor.current];
    if (entry !== undefined) props.onChange(entry);
  };

  return (
    <section className="bessel-script" aria-label="Scripting console">
      <label className="bessel-script-label" htmlFor="bessel-script-input">
        Script (one verb per line; # for comments). Cmd/Ctrl+Enter runs.
      </label>
      <textarea
        id="bessel-script-input"
        className="bessel-script-input"
        spellCheck={false}
        rows={8}
        value={props.source}
        placeholder={PLACEHOLDER}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            run();
            return;
          }
          // Recall prior submissions, but only when it would not fight text editing:
          // ArrowUp at the very start (or empty), ArrowDown at the very end.
          const el = e.currentTarget;
          const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
          const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
          if (e.key === 'ArrowUp' && atStart) {
            e.preventDefault();
            recall(-1);
          } else if (e.key === 'ArrowDown' && atEnd) {
            e.preventDefault();
            recall(1);
          }
        }}
        data-testid="script-input"
      />
      <div className="bessel-script-actions" role="group" aria-label="Script actions">
        <button type="button" onClick={run} data-testid="script-run">
          Run script
        </button>
        <button type="button" onClick={props.onClearLog} data-testid="script-clear-log">
          Clear log
        </button>
        <button
          type="button"
          disabled={props.log.length === 0}
          onClick={() => void navigator.clipboard?.writeText(props.log.join('\n'))}
          data-testid="script-copy-log"
        >
          Copy log
        </button>
      </div>

      <div className="bessel-script-save" role="group" aria-label="Save the current script">
        <label className="bessel-visually-hidden" htmlFor="bessel-script-name">
          Script name
        </label>
        <input
          id="bessel-script-name"
          className="bessel-script-name"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="script-name"
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            props.onSave(name.trim());
            setName('');
          }}
          data-testid="script-save"
        >
          Save
        </button>
      </div>

      {props.savedScriptNames.length === 0 ? (
        <p className="bessel-script-saved-empty">No saved scripts yet</p>
      ) : (
        <ul className="bessel-script-saved-list" data-testid="script-saved-list">
          {props.savedScriptNames.map((n) => (
            <li key={n} className="bessel-script-saved-row">
              <button
                type="button"
                className="bessel-script-saved-load"
                onClick={() => props.onLoadSaved(n)}
                data-testid={`script-load-${n}`}
              >
                {n}
              </button>
              <button
                type="button"
                className="bessel-script-saved-delete"
                aria-label={`Delete ${n}`}
                onClick={() => props.onDeleteSaved(n)}
                data-testid={`script-delete-${n}`}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <pre
        className="bessel-script-output"
        role="log"
        aria-label="Script output"
        aria-live="polite"
        data-testid="script-output"
      >
        {props.log.join('\n')}
      </pre>

      <details className="bessel-script-ref" open>
        <summary data-testid="script-verbs-toggle">Verb reference ({props.verbs.length})</summary>
        <ul className="bessel-script-verbs" data-testid="script-verbs">
          {props.verbs.map((v) => (
            <li key={v.verb}>
              <code>{v.verb}</code>
              {v.arity > 0 ? <span className="bessel-script-arity"> ({v.arity} arg)</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
