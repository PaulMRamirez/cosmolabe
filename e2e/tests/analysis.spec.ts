import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze, expandCard } from './sample.ts';

// The analysis tools surface real engine results in the UI. The re-slot groups them into
// six intent-named domain tabs, each tool inside a collapsible TaskCard; the assertions
// below navigate to the new tab and expand the card before driving the tool. (STK_PARITY F5.)

test('lighting analysis computes and renders eclipse intervals', async ({ page }) => {
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
  // The margin-vs-time chart draws the link-closes threshold (margin = 0).
  await expect(page.getByTestId('link-margin-chart-threshold')).toBeVisible();

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

  // The single-pair closest-approach card is kept (now collapsed by default): expand and run it.
  await expandCard(page, 'closest-approach');
  await page.getByTestId('compute-conjunction').click();
  await expect(page.getByTestId('conjunction-result')).toContainText('Pc');

  // Constellation design (Coverage & Constellation tab): a Walker pattern, synchronous.
  await openAnalyze(page, 'coverage');
  await expandCard(page, 'constellation');
  await page.getByTestId('compute-constellation').click();
  // The design now publishes each Walker satellite as an SPK asset (the swept asset set),
  // so allow for the lazy coverage-ops chunk + the per-satellite SPK writes.
  await expect(page.getByTestId('constellation-result')).toContainText('Walker', { timeout: 20_000 });

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
