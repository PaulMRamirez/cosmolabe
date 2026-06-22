import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze, expandCard } from './sample.ts';

// The analysis tools surface real engine results in the UI. The re-slot groups them into
// six intent-named domain tabs, each tool inside a collapsible TaskCard; the assertions
// below navigate to the new tab and expand the card before driving the tool. (STK_PARITY F5.)
//
// Each domain flow is its OWN independent test that loads the page fresh and asserts its
// own slice. Splitting the former single mega-test lets the flows parallelize (the CI
// e2e job runs fullyParallel with default workers), so no one test accumulates dozens of
// sequential real-SPICE-worker steps and blows the 60 s default under parallel contention.
// The genuinely heavy real-geometry flows (a full-day eclipse sweep, the multi-screen
// conjunction flow, the coverage grid sweep) raise THEIR OWN timeout: that compute is
// legitimately slow on CI, so a per-test setTimeout is the correct lever, not a weaker
// assertion.

test('lighting analysis computes and renders eclipse intervals', async ({ page }) => {
  // A full-phase eclipse sweep over a day is real geometry-finder work on the SPICE worker
  // and is legitimately slow under parallel CI load; give it a safe margin over the default.
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The Analyze dock is always reachable; before a spacecraft is loaded the Lighting &
  // Geometry tab shows a "load a spacecraft" notice and runs its tools on sample data.
  await expect(page.getByTestId('analyze-toggle')).toBeVisible();
  await openAnalyze(page, 'lighting-geometry');
  await expect(page.getByTestId('analysis-empty-notice')).toBeVisible();

  await loadCassiniSample(page);
  // The dock stays open (no auto-dismiss); the notice clears once a spacecraft loads.
  await openAnalyze(page, 'lighting-geometry');
  await expect(page.getByTestId('analysis-empty-notice')).toHaveCount(0);

  // Eclipse lives in the Lighting & Geometry tab; expand its card, then run it.
  await expandCard(page, 'eclipse');
  await page.getByTestId('compute-eclipse').click();

  // The full-phase result appears: the umbra Gantt (one of the four stacked phase
  // timelines) with an interval count, plus the per-day shadowed-duration readout.
  await expect(page.getByTestId('eclipse-umbra-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('eclipse-penumbra-timeline')).toBeVisible();
  await expect(page.getByTestId('eclipse-sunlit-timeline')).toBeVisible();
  await expect(page.getByTestId('eclipse-umbra-timeline').getByTestId('interval-count')).toContainText('interval');
  await expect(page.getByTestId('eclipse-duration')).toContainText('min/day');

  // The range analysis plots the spacecraft-to-center-body distance as a
  // time-series polyline (the second charting primitive, batched spkpos path).
  await expandCard(page, 'range');
  await page.getByTestId('compute-range').click();
  await expect(page.getByTestId('range-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('range-chart').locator('polyline')).toHaveCount(1);
  // B24: a located success note appears at the action site.
  await expect(page.getByTestId('compute-range-status')).toContainText('Done', { timeout: 20_000 });

  // B18: the result is also a copyable data table. Chart is the default; toggling to
  // Table shows the underlying rows, Copy writes TSV to the clipboard, and the digits
  // selector changes the cell precision.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('range-result-view-table').click();
  await expect(page.getByTestId('range-result-table')).toBeVisible();
  await expect(page.getByTestId('range-result-table')).toContainText('et (s)');
  await page.getByTestId('range-result-copy').click();
  await expect(page.getByTestId('range-result-copy')).toHaveText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('et (s)');
  expect(clip).toMatch(/\d/);
  await page.getByTestId('range-result-precision').selectOption('3');
});

test('access analysis assembles the constraint stack, link budget, and station worksheet', async ({ page }) => {
  // The access geometry-finder plus the station-pass rise/set search are real SPICE-worker
  // sweeps; give the assembled flow a margin over the default under parallel CI load.
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // The access analysis (Access & Comms tab) assembles a constraint stack (line-of-sight on
  // by default) and finds the surviving spacecraft-to-target window through the geometry-finder.
  await openAnalyze(page, 'access-comms');
  await expandCard(page, 'access');
  await expect(page.getByTestId('access-constraint-form')).toBeVisible();
  await expect(page.getByTestId('constraint-los')).toBeChecked();
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('access-result').getByTestId('interval-count')).toContainText(
    'interval',
  );
  // The access run also reduces the window to a figure of merit (@bessel/coverage) and shows a
  // per-constraint breakdown of how each enabled constraint narrowed the span.
  await expect(page.getByTestId('access-fom')).toContainText('Coverage');
  await expect(page.getByTestId('access-breakdown')).toBeVisible();

  // The communications analysis plots the downlink Eb/N0 to Earth, combining the
  // geometric range with the link-budget physics (@bessel/rf).
  await expandCard(page, 'link');
  await page.getByTestId('compute-link').click();
  await expect(page.getByTestId('link-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-chart').locator('polyline')).toHaveCount(1);

  // [ux-p2-access] Ground-station registry + az/el-mask passes + the link-budget worksheet
  // (comms-engineer journey). Register a station in the SHARED context bar (it is first-class
  // shared context the access cards read by role), compute the rise/set passes over it, then
  // assemble the itemized worksheet and read its margin + MODCOD threshold.
  await expect(page.getByTestId('station-registry')).toBeVisible();
  await page.getByTestId('station-add-toggle').click();
  await page.getByTestId('station-name').fill('Test Station');
  await page.getByTestId('station-lon').fill('-116.9');
  await page.getByTestId('station-lat').fill('35.4');
  await page.getByTestId('station-alt').fill('1');
  await page.getByTestId('station-minel').fill('5');
  await page.getByTestId('station-save').click();
  // The saved station becomes active (the active note names it).
  await expect(page.getByTestId('station-active-note')).toContainText('Test Station');

  await expandCard(page, 'station-passes');
  await page.getByTestId('compute-station-passes').click();
  await expect(page.getByTestId('compute-station-passes-status')).toContainText('Done', { timeout: 20_000 });

  // If the spacecraft rises over the station in the span, bind the first pass row; otherwise the
  // worksheet falls back to a representative geometry. Either way the worksheet + margin must render.
  const firstPass = page.getByTestId('select-pass-pass-0');
  if (await firstPass.isVisible().catch(() => false)) {
    await firstPass.click();
  }
  await expandCard(page, 'link-worksheet');
  await expect(page.getByTestId('param-modcod')).toBeVisible();
  await page.getByTestId('compute-link-worksheet').click();
  await expect(page.getByTestId('link-worksheet')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-margin')).toContainText('Margin');
  // The margin-vs-time chart draws the link-closes threshold (margin = 0) as a horizontal SVG
  // <line>. A horizontal line has zero height, so Playwright's toBeVisible() (which needs a
  // non-empty box) reports it hidden even though it is drawn; assert PRESENCE and POSITION instead:
  // exactly one threshold line is attached, it is horizontal (y1 === y2), and its y sits inside the
  // chart's drawable band (the 2 px pad .. height - 2 px), i.e. it is on-canvas, not clipped away.
  const threshold = page.getByTestId('link-margin-chart-threshold');
  await expect(threshold).toHaveCount(1);
  const y1 = Number(await threshold.getAttribute('y1'));
  const y2 = Number(await threshold.getAttribute('y2'));
  expect(y1).toBe(y2);
  expect(y1).toBeGreaterThanOrEqual(2);
  expect(y1).toBeLessThanOrEqual(78);
});

test('conjunction ingests a CDM, screens it, and runs the full-covariance Pc flows', async ({ page }) => {
  // CDM ingest -> worker screen -> per-event full-covariance Pc, then the maneuver-then-rescreen
  // loop and the explicit covariance-input flow. This is the heaviest single domain (multiple
  // real screens plus an MCS corrector run), so it gets the widest margin.
  test.setTimeout(150_000);

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Conjunction (Conjunction tab): REAL CDM ingestion -> worker screen -> per-event
  // full-covariance Pc + B-plane (analysis-UX Phase 1). Load the sample CDM, ingest it, screen
  // the ingested catalog, click the flagged event, and read the full-covariance Pc + the B-plane.
  await openAnalyze(page, 'conjunction');
  await expandCard(page, 'catalog-screen');
  await page.getByTestId('ingest-sample').click();
  await page.getByTestId('ingest-run').click();
  await expect(page.getByTestId('ingest-summary')).toContainText('with covariance', { timeout: 20_000 });
  await page.getByTestId('screen-catalog').click();
  await expandCard(page, 'per-event-pc');
  await expect(page.getByTestId('conjunction-event-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('conjunction-event-0').click();
  await expect(page.getByTestId('pc-full')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pc-max')).toBeVisible();
  await expect(page.getByTestId('bplane-view')).toBeVisible();
  // [ux-p2-conjunction] the CDM event already carries covariance, so the export-CDM action is offered.
  await expect(page.getByTestId('export-cdm')).toBeVisible();

  // [ux-p3-conjunction] Watchlist: add the selected event to the watchlist and see its row appear.
  await page.getByTestId('watch-event').click();
  await expandCard(page, 'watchlist');
  await expect(page.getByTestId('watchlist')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('watchlist-row')).toHaveCount(1);

  // [ux-p3-conjunction] Maneuver-then-rescreen loop: plan the avoidance burn (seeds the editable MCS
  // and jumps to Orbit & Maneuver), run the MCS corrector, return to Conjunction, and screen after the
  // maneuver. The before/after Pc readout shows the risk change; the watched row updates with it.
  await expandCard(page, 'per-event-pc');
  await page.getByTestId('plan-avoidance-burn').click();
  // The carrier switched to the Orbit & Maneuver tab; run the seeded MCS through its corrector.
  await expect(page.getByTestId('tab-orbit-maneuver')).toHaveAttribute('aria-selected', 'true');
  await expandCard(page, 'mcs');
  await page.getByTestId('run-mcs').click();
  await expect(page.getByTestId('mcs-result')).toBeVisible({ timeout: 20_000 });
  // Back to Conjunction, re-select the event, and screen after the maneuver.
  await openAnalyze(page, 'conjunction');
  await expandCard(page, 'per-event-pc');
  await page.getByTestId('conjunction-event-0').click();
  await page.getByTestId('rescreen-after-maneuver').click();
  await expect(page.getByTestId('pc-before-after')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pc-before-after')).toContainText('Pc before');

  // [ux-p2-conjunction] Explicit covariance INPUT flow: ingest a covariance-less catalog (OEM),
  // screen it, select the flagged event, supply an assumed covariance, and read the now-available
  // full-covariance Pc. Re-ingesting supersedes the prior CDM catalog.
  await expandCard(page, 'catalog-screen');
  await page.getByTestId('ingest-format').selectOption('oem');
  await page.getByTestId('ingest-sample').click();
  await page.getByTestId('ingest-run').click();
  await expect(page.getByTestId('ingest-summary')).toContainText('0 with covariance', { timeout: 20_000 });
  await page.getByTestId('screen-catalog').click();
  await expandCard(page, 'per-event-pc');
  await expect(page.getByTestId('conjunction-event-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('conjunction-event-0').click();
  // The selected row is marked, and the covariance-input form appears (no covariance in this catalog).
  await expect(page.getByTestId('conjunction-event-0')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('covariance-input')).toBeVisible();
  await expect(page.getByTestId('pc-full')).toContainText('n/a');
  // Supply an assumed RTN covariance for both objects, then read the full-covariance Pc.
  await page.getByTestId('param-cov-sigma').fill('1');
  await page.getByTestId('cov-apply').click();
  await expect(page.getByTestId('cov-supplied-summary')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('cov-object').selectOption({ index: 1 });
  await page.getByTestId('cov-apply').click();
  await expect(page.getByTestId('pc-full')).not.toContainText('n/a', { timeout: 20_000 });
  await page.getByTestId('export-cdm').click();

  // The single-pair closest-approach card is kept (now collapsed by default): expand and run it.
  await expandCard(page, 'closest-approach');
  await page.getByTestId('compute-conjunction').click();
  await expect(page.getByTestId('conjunction-result')).toContainText('Pc');
});

test('coverage designs a constellation and runs the worker coverage-grid sweep', async ({ page }) => {
  // This test proves the WORKER PIPELINE (design -> dedicated coverage worker sweep -> live
  // progress -> contour/FOM summary), not a realistic heavy coverage map. The default 24/3/1
  // Walker x 9x18 grid is minutes-long under contended CI; deliberately drive the real param
  // controls to a TINY constellation (4/2/1) and a COARSE grid (3x3) so the same worker path
  // runs in a few seconds. A 90s budget is ample headroom for the small sweep under CI load.
  test.setTimeout(90_000);

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Constellation design (Coverage & Constellation tab): a tiny but valid Walker pattern
  // (T=4, P=2, F=1; T is a multiple of P so walkerConstellation builds), so the swept asset
  // set is 4 satellites, not 24. Driven through the real T/P/F controls, not the engine API.
  await openAnalyze(page, 'coverage');
  await expandCard(page, 'constellation');
  await page.getByTestId('param-const-total').fill('4');
  await page.getByTestId('param-const-planes').fill('2');
  await page.getByTestId('param-const-phasing').fill('1');
  await page.getByTestId('compute-constellation').click();
  // The design publishes each Walker satellite as an SPK asset (the swept asset set), so allow
  // for the lazy coverage-ops chunk + the per-satellite SPK writes.
  await expect(page.getByTestId('constellation-result')).toContainText('Walker', { timeout: 20_000 });

  // [ux-p3-coverage] The coverage sweep runs on the dedicated coverage worker (its own chunk,
  // with a nested SPICE worker replaying the kernel pool). Coarsen the grid to 3x3 cells through
  // the real resolution controls so the worker sweeps 9 cells, not 162: the same pipeline, fast.
  // Running it shows the live progress readout, and the run completes with the FOM summary (the
  // worker did not stall).
  await expandCard(page, 'coverage-grid');
  await page.getByTestId('param-grid-resolution').fill('3');
  await page.getByTestId('param-grid-lon-count').fill('3');
  await page.getByTestId('compute-coverage-grid').click();
  await expect(page.getByTestId('coverage-progress')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('coverage-fom-summary')).toBeVisible({ timeout: 60_000 });
});

test('maneuver, map, and lighting plots render their charts and exports', async ({ page }) => {
  // Slew profile + Lambert transfer + ground track (with re-projection) + beta-angle season +
  // solar intensity + OEM export. Several moderate real-geometry plots back to back; give a
  // margin over the default for parallel CI load.
  test.setTimeout(120_000);

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Attitude slew (Orbit & Maneuver tab): an eigen-axis profile plotted over time.
  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'slew');
  await page.getByTestId('compute-slew').click();
  await expect(page.getByTestId('slew-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('slew-chart').locator('polyline')).toHaveCount(1);

  // Maneuver design (Orbit & Maneuver tab): a Lambert transfer delta-v (@bessel/mission).
  await expandCard(page, 'lambert');
  await page.getByTestId('compute-transfer').click();
  await expect(page.getByTestId('transfer-result')).toContainText('delta-v');

  // 2D map (Lighting & Geometry tab): the sub-spacecraft ground track.
  await openAnalyze(page, 'lighting-geometry');
  await expandCard(page, 'ground-track');
  await page.getByTestId('compute-groundtrack').click();
  await expect(page.getByTestId('ground-track')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('ground-track').locator('polyline').first()).toBeVisible();

  // [ux-p3-coverage] The projection is selectable: switching to polar stereographic re-projects
  // the same track (the map stays rendered, never blanks). The select drives the @bessel/ui map.
  await expect(page.getByTestId('param-groundtrack-projection')).toBeVisible();
  await page.getByTestId('param-groundtrack-projection').selectOption('polar-stereographic');
  await expect(page.getByTestId('ground-track')).toBeVisible();
  await page.getByTestId('param-groundtrack-projection').selectOption('mercator');
  await expect(page.getByTestId('ground-track').locator('polyline').first()).toBeVisible();

  // Beta-angle season (Lighting & Geometry tab): the beta (deg) plot plus the
  // eclipse-onset threshold readout.
  await expandCard(page, 'beta');
  await page.getByTestId('compute-beta').click();
  await expect(page.getByTestId('beta-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('beta-onset')).toContainText('Eclipse season');

  // Solar intensity (Lighting & Geometry tab): the visible solar-disk fraction (0..1).
  await expandCard(page, 'solar-intensity');
  await page.getByTestId('compute-solar-intensity').click();
  await expect(page.getByTestId('solar-intensity-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('solar-intensity-hint')).toContainText('full sun');

  // Interop (Report & Compare tab): exporting the trajectory downloads a CCSDS OEM file.
  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'export-oem');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-oem').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.oem');
});

test('the in-FOV tool computes instrument-target visibility windows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);
  await openAnalyze(page, 'access-comms');

  // With the Cassini ISS sensor loaded, the in-FOV tool is enabled; the pointing mode is
  // selectable (nadir | sun), and running it reports the FOV-only window AND the post-constraint
  // surviving window, each reduced to a figure of merit and a located note.
  await expandCard(page, 'in-fov');
  await expect(page.getByTestId('param-fov-pointing')).toBeVisible();
  await page.getByTestId('param-fov-pointing').selectOption('sun');
  const fov = page.getByTestId('compute-fov');
  await expect(fov).toBeEnabled();
  await fov.click();
  await expect(page.getByTestId('fov-fom')).toContainText('In view', { timeout: 20_000 });
  await expect(page.getByTestId('fov-surviving-fom')).toContainText('Surviving', { timeout: 20_000 });
  await expect(page.getByTestId('compute-fov-status')).toContainText('Done', { timeout: 20_000 });
});

test('the terrain-LOS constraint is UNGATED once a terrain source is chosen (Phase 3)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);
  await openAnalyze(page, 'access-comms');
  await expandCard(page, 'access');

  // The terrain LOS toggle starts disabled (no terrain source). Choosing the built-in sample-ridge
  // DEM source UNGATES it: the toggle becomes enabled and the sample-data note appears.
  const terrain = page.getByTestId('constraint-terrainlos');
  await expect(terrain).toBeDisabled();
  await page.getByTestId('param-terrain-source').selectOption('sample-ridge');
  await expect(page.getByTestId('terrain-sample-note')).toBeVisible();
  await expect(terrain).toBeEnabled();

  // Enable the terrain LOS constraint and recompute access: the run threads the sample DEM into the
  // constraint stack and still produces a surviving access window (no error).
  await terrain.check();
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('compute-access-status')).toContainText('Done', { timeout: 20_000 });
});

test('the observation multi-target schedule builds a conflict-free timeline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);
  await openAnalyze(page, 'access-comms');

  // The multi-target schedule card takes a target LIST, the pointing mode, and the constraint stack,
  // then builds an ordered, non-overlapping schedule with the per-target slew honored, plus any
  // unscheduled (conflicted) targets.
  await expandCard(page, 'observation-schedule');
  await expect(page.getByTestId('param-target-list')).toBeVisible();
  // Titan and Sun are observation targets; Saturn (the mission center body) is reported unscheduled
  // gracefully rather than aborting the run, exercising both the scheduled and unscheduled paths.
  await page.getByTestId('param-target-list').fill('Titan, Sun, Saturn');
  await page.getByTestId('compute-observation-schedule').click();

  // The schedule surface appears: the timeline (a Gantt of the placed slots) and the unscheduled
  // list, with a located success note.
  await expect(page.getByTestId('multi-target-schedule')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('schedule-timeline')).toBeVisible();
  await expect(page.getByTestId('schedule-unscheduled')).toBeVisible();
  await expect(page.getByTestId('compute-observation-schedule-status')).toContainText('Done', { timeout: 20_000 });
});

test('analysis tools honor user-supplied parameters (span, target, secondary)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);
  await openAnalyze(page, 'lighting-geometry');

  // Tools use the shared context by default; turn the override on to drive the
  // span-based and target-based tools with this tab's own parameters.
  await expect(page.getByTestId('analysis-params')).toBeVisible();
  await page.getByTestId('analysis-use-shared').uncheck();
  await page.getByTestId('param-span-days').fill('2');
  await page.getByTestId('param-target').selectOption('Saturn');

  // Range over the 2-day span, to the chosen target, still renders a polyline.
  await expandCard(page, 'range');
  await page.getByTestId('compute-range').click();
  await expect(page.getByTestId('range-chart').locator('polyline')).toHaveCount(1, { timeout: 20_000 });

  // Conjunction against a user-chosen secondary object reports that object by name.
  await openAnalyze(page, 'conjunction');
  await page.getByTestId('param-secondary').selectOption('Saturn');
  await expandCard(page, 'closest-approach');
  await page.getByTestId('compute-conjunction').click();
  await expect(page.getByTestId('conjunction-result')).toContainText('Saturn');
});
