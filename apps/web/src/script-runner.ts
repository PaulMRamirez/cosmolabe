// A line-oriented interpreter for the in-app scripting console. It maps the
// Cosmographia cosmoscripting verb vocabulary onto BesselScript methods without
// eval: each non-blank, non-comment line is `verb arg1 arg2 ...`, the verb is
// looked up in a fixed allowlist, the args are coerced (numbers including
// scientific notation, quoted strings, bare ids), and the bound method is
// called. Errors are typed and loud: the first failing line is reported with its
// 1-based line number and message, while every prior successful line still
// appears in echoLines so the user sees how far the program got.

import type { SettingKey } from '@bessel/ui';
import type { BesselScript, ScriptFrame } from './scripting.ts';

/** Typed error for a script that fails at a specific source line. */
export class ScriptError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = 'ScriptError';
  }
}

export interface ScriptResult {
  /** True when every line ran without error. */
  readonly ok: boolean;
  /** One human-readable echo per executed verb, in order. */
  readonly echoLines: readonly string[];
  /** The first failing line, or null when ok. */
  readonly error: { readonly line: number; readonly message: string } | null;
}

/** A parsed argument: a number, a string literal, or a bare identifier. */
type Arg = { readonly kind: 'number'; readonly value: number } | { readonly kind: 'text'; readonly value: string };

/** The nine visualization layer keys the show/hide verbs accept. */
const LAYER_KEYS: readonly SettingKey[] = [
  'trajectory',
  'orbits',
  'labels',
  'fov',
  'footprint',
  'axes',
  'stars',
  'atmosphere',
  'shadows',
];

const FRAME_MODES: readonly ScriptFrame[] = ['orbit', 'sync', 'free'];

/** An allowlisted verb: how many args it needs and how to apply it. */
interface VerbSpec {
  readonly arity: number;
  readonly apply: (s: BesselScript, args: readonly Arg[], line: number) => void;
}

function asText(arg: Arg | undefined, line: number, what: string): string {
  if (!arg) throw new ScriptError(line, `expected ${what}`);
  return arg.kind === 'number' ? String(arg.value) : arg.value;
}

function asNumber(arg: Arg | undefined, line: number, what: string): number {
  if (!arg || arg.kind !== 'number') throw new ScriptError(line, `expected a number for ${what}`);
  return arg.value;
}

function asLayer(arg: Arg | undefined, line: number): SettingKey {
  const key = asText(arg, line, 'a layer name');
  if (!LAYER_KEYS.includes(key as SettingKey)) {
    throw new ScriptError(line, `unknown layer "${key}" (one of: ${LAYER_KEYS.join(', ')})`);
  }
  return key as SettingKey;
}

function asFrame(arg: Arg | undefined, line: number): ScriptFrame {
  const mode = asText(arg, line, 'a frame mode');
  if (!FRAME_MODES.includes(mode as ScriptFrame)) {
    throw new ScriptError(line, `unknown frame "${mode}" (one of: ${FRAME_MODES.join(', ')})`);
  }
  return mode as ScriptFrame;
}

// The verb table is the allowlist: any verb not present is rejected loudly. Names
// match cosmoscripting where one exists; aliases share an apply.
const VERBS: Readonly<Record<string, VerbSpec>> = {
  gotoObject: { arity: 1, apply: (s, a, l) => void s.gotoObject(asText(a[0], l, 'an object name')) },
  gotoHome: { arity: 0, apply: (s) => void s.gotoHome() },
  selectObject: { arity: 1, apply: (s, a, l) => void s.select(asText(a[0], l, 'an object id')) },
  setTime: { arity: 1, apply: (s, a, l) => void s.setTime(asNumber(a[0], l, 'time')) },
  setTimeRate: { arity: 1, apply: (s, a, l) => void s.setTimeRate(asNumber(a[0], l, 'rate')) },
  pause: { arity: 0, apply: (s) => void s.pause() },
  unpause: { arity: 0, apply: (s) => void s.unpause() },
  play: { arity: 0, apply: (s) => void s.play() },
  trackObject: { arity: 1, apply: (s, a, l) => void s.track(asText(a[0], l, 'an object name')) },
  untrack: { arity: 0, apply: (s) => void s.untrack() },
  setFrame: { arity: 1, apply: (s, a, l) => void s.setFrame(asFrame(a[0], l)) },
  show: { arity: 1, apply: (s, a, l) => void s.show(asLayer(a[0], l)) },
  hide: { arity: 1, apply: (s, a, l) => void s.hide(asLayer(a[0], l)) },
  showObject: { arity: 1, apply: (s, a, l) => void s.showObject(asText(a[0], l, 'an object id')) },
  hideObject: { arity: 1, apply: (s, a, l) => void s.hideObject(asText(a[0], l, 'an object id')) },
  saveScreenShot: { arity: 0, apply: (s) => void s.screenshot() },
  startRecordingVideoToFile: { arity: 0, apply: (s) => void s.record() },
  stopRecordingVideo: { arity: 0, apply: (s) => void s.stopRecord() },
  displayNote: { arity: 1, apply: (s, a, l) => void s.displayNote(asText(a[0], l, 'note text')) },
  loadCatalogFile: { arity: 1, apply: (s, a, l) => void s.loadCatalog(asText(a[0], l, 'a catalog url')) },
  viewFromSun: { arity: 0, apply: (s) => void s.viewFromSun() },
  viewAlongVelocity: { arity: 0, apply: (s) => void s.viewAlongVelocity() },
};

/** The accepted verb names, each with its argument count, for the console reference. */
export const SCRIPT_VERBS: readonly { readonly verb: string; readonly arity: number }[] = Object.entries(
  VERBS,
).map(([verb, spec]) => ({ verb, arity: spec.arity }));

/** Split a line into tokens, honoring double-quoted string literals. */
function tokenize(line: number, text: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1] !== undefined) tokens.push(`"${match[1]}"`);
    else if (match[2] !== undefined) {
      if (match[2].includes('"')) throw new ScriptError(line, 'unterminated string literal');
      tokens.push(match[2]);
    }
  }
  return tokens;
}

/** Coerce a raw token into a number, quoted string, or bare identifier. */
function coerce(token: string): Arg {
  if (token.startsWith('"') && token.endsWith('"')) {
    return { kind: 'text', value: token.slice(1, -1) };
  }
  // A number, including scientific notation (e.g. 7.2e8) and signs.
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(token)) {
    return { kind: 'number', value: Number(token) };
  }
  return { kind: 'text', value: token };
}

/**
 * Run a script source against a BesselScript. Pure: it does not throw; the first
 * failing line is captured in result.error while earlier successes are echoed.
 */
export function runScript(source: string, script: BesselScript): ScriptResult {
  const echoLines: string[] = [];
  const rawLines = source.split('\n');
  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNo = i + 1;
    const text = (rawLines[i] ?? '').replace(/#.*$/, '').trim();
    if (text === '') continue;
    try {
      const tokens = tokenize(lineNo, text);
      const verb = tokens[0] ?? '';
      const spec = VERBS[verb];
      if (!spec) throw new ScriptError(lineNo, `unknown verb "${verb}"`);
      const args = tokens.slice(1).map(coerce);
      if (args.length < spec.arity) {
        throw new ScriptError(lineNo, `${verb} expects ${spec.arity} argument(s), got ${args.length}`);
      }
      spec.apply(script, args, lineNo);
      echoLines.push(`${lineNo}: ${text}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, echoLines, error: { line: lineNo, message } };
    }
  }
  return { ok: true, echoLines, error: null };
}
