// Pure helpers for the Orbit & Maneuver tab's editable spacecraft source: the typed
// SpacecraftSource model (a pasted TLE or a loaded scene object), and the parse that turns
// pasted lines into a validated source. Keeping the parse pure and headless (it only calls
// @bessel/propagator's parseTle and shapes the result) lets the panel and the analysis ops
// share one validated source, and makes the parse unit-testable without a DOM. Fails loudly:
// a malformed TLE surfaces the located TleError message, never a silent fallback to bundled
// sample data. (analysis-UX Phase 1, design section 3 tab 1.)

import { parseTle } from '@bessel/propagator';
import type { SpacecraftSource } from '../store/index.ts';

export type { SpacecraftSource } from '../store/index.ts';

/** The TLE variant of the source (narrowed for the parse result). */
export type TleSource = Extract<SpacecraftSource, { kind: 'tle' }>;

/** The two control modes the source picker toggles between. */
export type SourceMode = 'tle' | 'object';

/** Outcome of parsing pasted TLE text: a validated source, or a located error message. */
export type TleParseResult =
  | { readonly ok: true; readonly source: TleSource }
  | { readonly ok: false; readonly error: string };

/**
 * Parse a pasted block of TLE text into a validated TleSource. Accepts an optional leading
 * name line (a 3-line TLE) followed by the two element lines, or just the two element lines.
 * Validation (column widths, checksum) is delegated to @bessel/propagator's parseTle, whose
 * located TleError message is surfaced verbatim on failure. The display name is the optional
 * name line, else "TLE <satnum>" from the parsed catalog number.
 */
export function parseTleSource(text: string): TleParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: 'paste two lines (a TLE), optionally preceded by a name line' };
  }
  // A 3-line set leads with a name; otherwise the two element lines are the whole input.
  const hasName = lines.length >= 3 && !/^[12] /.test(lines[0]!);
  const nameLine = hasName ? lines[0]!.trim() : '';
  const line1 = hasName ? lines[1]! : lines[0]!;
  const line2 = hasName ? lines[2]! : lines[1]!;
  try {
    const tle = parseTle(line1, line2);
    const name = nameLine !== '' ? nameLine : `TLE ${tle.satnum}`;
    return { ok: true, source: { kind: 'tle', name, line1, line2 } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
