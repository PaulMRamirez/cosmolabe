// The AnalysisLauncher: a tiny "what do you want to analyze?" search at the top of the
// Analyze tabpanel (design section 3, committed fix 5). It filters a STATIC registry of
// cards by intent keyword and, on selection, switches to the owning tab and asks the
// accordion to expand that card. Deliberately small: a static array of {id, title, tab,
// keywords}, no engine or heavy code, so it stays out of the first-paint shell budget.

import { useId, useState, type KeyboardEvent } from 'react';
import type { AnalyzeTab } from '../store/index.ts';

/** One launchable analysis card: its accordion id, the owning tab, a label, and the
 *  intent keywords the search matches against. Kept static so the shell stays tiny. */
export interface LauncherEntry {
  readonly id: string;
  readonly title: string;
  readonly tab: AnalyzeTab;
  readonly keywords: string;
}

/** The static card registry the launcher searches. Ids match the TaskCard ids in each
 *  domain panel so a hit can expand the exact card. Order groups by tab for readability. */
export const LAUNCHER_REGISTRY: readonly LauncherEntry[] = [
  { id: 'propagate', title: 'Propagate orbit (SGP4 / HPOP)', tab: 'orbit-maneuver', keywords: 'tle state sgp4 hpop propagate altitude period orbit' },
  { id: 'mcs', title: 'Mission control sequence', tab: 'orbit-maneuver', keywords: 'mcs mission burn maneuver corrector segment target' },
  { id: 'od', title: 'Orbit determination', tab: 'orbit-maneuver', keywords: 'od orbit determination least squares residual covariance estimate' },
  { id: 'slew', title: 'Attitude slew', tab: 'orbit-maneuver', keywords: 'attitude slew pointing eigen axis maneuver' },
  { id: 'lambert', title: 'Lambert transfer', tab: 'orbit-maneuver', keywords: 'lambert transfer delta-v two impulse departure' },
  { id: 'range', title: 'Range to a target', tab: 'lighting-geometry', keywords: 'range distance geometry target' },
  { id: 'ground-track', title: 'Ground track', tab: 'lighting-geometry', keywords: 'ground track sub-point subsatellite lon lat' },
  { id: 'beta', title: 'Beta-angle season', tab: 'lighting-geometry', keywords: 'beta angle season sun orbit plane eclipse onset lighting' },
  { id: 'eclipse', title: 'Eclipse phases', tab: 'lighting-geometry', keywords: 'eclipse umbra penumbra annular sunlit lighting shadow phase' },
  { id: 'solar-intensity', title: 'Solar intensity', tab: 'lighting-geometry', keywords: 'solar intensity penumbra fraction power thermal disk sun visible' },
  { id: 'access', title: 'Line-of-sight access', tab: 'access-comms', keywords: 'access visibility line of sight pass window' },
  { id: 'in-fov', title: 'In-FOV observation windows', tab: 'access-comms', keywords: 'fov field of view sensor instrument observation' },
  { id: 'link', title: 'Downlink budget', tab: 'access-comms', keywords: 'link budget comms downlink ebn0 eb/n0 radio' },
  { id: 'observation-schedule', title: 'Observation multi-target schedule', tab: 'access-comms', keywords: 'observation schedule multi target timeline slew conflict plan' },
  { id: 'closest-approach', title: 'Closest approach (pair)', tab: 'conjunction', keywords: 'conjunction closest approach miss tca pc collision probability' },
  { id: 'catalog-screen', title: 'Catalog screening', tab: 'conjunction', keywords: 'catalog screen screening all-vs-all worker conjunction' },
  { id: 'constellation', title: 'Walker constellation', tab: 'coverage', keywords: 'walker constellation design planes satellites' },
  { id: 'coverage-grid', title: 'Coverage grid', tab: 'coverage', keywords: 'coverage grid area weighted fom revisit' },
  { id: 'report', title: 'Data-provider report', tab: 'report-compare', keywords: 'report provider table export csv' },
  { id: 'export-oem', title: 'Export trajectory (OEM)', tab: 'report-compare', keywords: 'export oem ccsds trajectory interop' },
  { id: 'compare', title: 'Compare kept results', tab: 'report-compare', keywords: 'compare kept snapshots trade telemetry overlay' },
];

/** Filter the static registry by an intent query (case-insensitive substring over the
 *  title and keywords). An empty query matches nothing (the dropdown stays closed). */
export function filterLauncher(query: string): readonly LauncherEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return LAUNCHER_REGISTRY.filter(
    (e) => e.title.toLowerCase().includes(q) || e.keywords.includes(q),
  );
}

/** The searchable domains, shown as a hint when the query is empty or matches nothing so the
 *  box is never a dead end: the user learns what intents the search understands. Derived from
 *  the registry tabs (one human label per tab) rather than hand-listed, so it cannot drift. */
const DOMAIN_LABELS: Readonly<Record<AnalyzeTab, string>> = {
  'orbit-maneuver': 'orbit & maneuver',
  'lighting-geometry': 'lighting & geometry',
  'access-comms': 'access & comms',
  conjunction: 'conjunction',
  coverage: 'coverage',
  'report-compare': 'report & compare',
};

/** The distinct domain labels in registry order, for the empty/no-match hint. */
export const LAUNCHER_DOMAINS: readonly string[] = (() => {
  const seen = new Set<AnalyzeTab>();
  const out: string[] = [];
  for (const e of LAUNCHER_REGISTRY) {
    if (!seen.has(e.tab)) {
      seen.add(e.tab);
      out.push(DOMAIN_LABELS[e.tab]);
    }
  }
  return out;
})();

export interface AnalysisLauncherProps {
  /** Switch to the owning tab and expand the chosen card. */
  readonly onLaunch: (entry: LauncherEntry) => void;
}

/** The search launcher input and its result list. Selecting a result calls onLaunch and
 *  clears the query. Keyboard and screen-reader operable: a labelled combobox input drives a
 *  listbox of options. ArrowDown/ArrowUp move a roving highlight (activeIndex, surfaced via
 *  aria-activedescendant), Enter activates the highlighted option (or the sole result),
 *  Escape clears the query. Click still works unchanged. When the query is empty or matches
 *  nothing, an unobtrusive hint lists the searchable domains so the box is never a dead end. */
export function AnalysisLauncher(props: AnalysisLauncherProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const baseId = useId();
  const listId = `${baseId}-results`;
  const optionId = (index: number): string => `${baseId}-option-${index}`;

  const results = filterLauncher(query);
  const trimmed = query.trim();
  // A non-empty query that matches nothing, or an empty (focused) box: both get the hint.
  const showHint = results.length === 0;

  // Clamp the active highlight when the result set shrinks under the cursor.
  const active = activeIndex >= 0 && activeIndex < results.length ? activeIndex : -1;

  const launch = (entry: LauncherEntry): void => {
    props.onLaunch(entry);
    setQuery('');
    setActiveIndex(-1);
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.key === 'ArrowDown') {
      if (results.length === 0) return;
      ev.preventDefault();
      setActiveIndex((i) => (i + 1 >= results.length ? 0 : i + 1));
    } else if (ev.key === 'ArrowUp') {
      if (results.length === 0) return;
      ev.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (ev.key === 'Enter') {
      // Enter activates the highlight, or the only result when there is exactly one.
      const target = active >= 0 ? results[active] : results.length === 1 ? results[0] : undefined;
      if (target) {
        ev.preventDefault();
        launch(target);
      }
    } else if (ev.key === 'Escape') {
      if (query) ev.preventDefault();
      setQuery('');
      setActiveIndex(-1);
    }
  };

  return (
    <div className="bessel-analysis-launcher" data-testid="analysis-launcher-root">
      <input
        type="search"
        className="bessel-launcher-input"
        aria-label="What do you want to analyze?"
        placeholder="What do you want to analyze?"
        value={query}
        data-testid="analysis-launcher"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {results.length > 0 ? (
        <ul
          className="bessel-launcher-results"
          data-testid="launcher-results"
          id={listId}
          role="listbox"
        >
          {results.map((entry, index) => (
            <li key={entry.id} role="presentation">
              <button
                type="button"
                className="bessel-launcher-result"
                data-testid={`launcher-result-${entry.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                aria-current={index === active ? true : undefined}
                onClick={() => launch(entry)}
              >
                {entry.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showHint ? (
        <p className="bessel-launcher-hint" data-testid="launcher-empty" role="note">
          {trimmed
            ? 'No tasks match; try a domain name: '
            : 'Search by intent or domain: '}
          {LAUNCHER_DOMAINS.join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
