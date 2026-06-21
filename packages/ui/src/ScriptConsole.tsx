// Scripting console: a small in-app editor that runs Cosmographia-style
// cosmoscripting verbs against the live viewer. Presentational only: the app
// owns the source string, holds the executed-verb log, persists named scripts,
// and wires the callbacks to the line interpreter and PAL Storage. The textarea
// and controls are labeled so the axe a11y scan passes.

import { useState } from 'react';

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
  // The load <select> resets to '' after each pick so re-selecting the SAME saved
  // name re-fires onChange (the reset-to-saved workflow must re-run, not be swallowed
  // by a controlled value already holding that name). The delete target is tracked
  // separately so the Delete control still knows which script the user last chose.
  const [selected, setSelected] = useState('');
  const [deleteTarget, setDeleteTarget] = useState('');

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
            props.onRun();
          }
        }}
        data-testid="script-input"
      />
      <div className="bessel-script-actions" role="group" aria-label="Script actions">
        <button type="button" onClick={props.onRun} data-testid="script-run">
          Run script
        </button>
        <button type="button" onClick={props.onClearLog} data-testid="script-clear-log">
          Clear log
        </button>
      </div>

      <div className="bessel-script-save" role="group" aria-label="Save and load scripts">
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
        <label className="bessel-visually-hidden" htmlFor="bessel-script-load">
          Load a saved script
        </label>
        <select
          id="bessel-script-load"
          value={selected}
          onChange={(e) => {
            const picked = e.target.value;
            if (picked) {
              setDeleteTarget(picked);
              props.onLoadSaved(picked);
            }
            // Always snap back to the placeholder so re-selecting the same name fires.
            setSelected('');
          }}
          data-testid="script-load"
        >
          <option value="">Load saved...</option>
          {props.savedScriptNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!deleteTarget || !props.savedScriptNames.includes(deleteTarget)}
          onClick={() => {
            if (deleteTarget) props.onDeleteSaved(deleteTarget);
            setDeleteTarget('');
            setSelected('');
          }}
          data-testid="script-delete"
        >
          Delete
        </button>
      </div>

      <pre
        className="bessel-script-output"
        role="log"
        aria-label="Script output"
        aria-live="polite"
        data-testid="script-output"
      >
        {props.log.join('\n')}
      </pre>

      <details className="bessel-script-ref">
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
