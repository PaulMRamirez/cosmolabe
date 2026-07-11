import { test, expect } from '@playwright/test';
import { openAnalyze, expandCard } from './sample.ts';

// The orbit-determination workbench is mission-independent: from a cold boot it drives
// @bessel/od batch least squares on a synthetic range / range-rate / angles measurement
// set generated from a known truth orbit, and reports the recovered state, the post-fit
// residual RMS, and a covariance summary. OD is folded into the Orbit & Maneuver tab
// (its "Orbit determination" TaskCard). (Tapley-Schutz-Born §4.3; Vallado §10.2.)

test('orbit determination recovers a state with a residual RMS and covariance', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'od');
  await page.getByTestId('run-od').click();

  await expect(page.getByTestId('od-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('od-rms')).toContainText('RMS');
  await expect(page.getByTestId('od-rms')).toContainText('observations');
  await expect(page.getByTestId('od-estimate')).toContainText('Estimated state');
  await expect(page.getByTestId('od-covariance')).toContainText('km');
});

// Wave 2B carrier: the OD covariance flows into the Conjunction supplied-covariance store via an
// explicit "Use in Conjunction" action (not a bare tab jump), so the SSA analyst gets the OD
// covariance into the per-event Pc without re-typing. Ingest a covariance-less OEM, screen, select
// the flagged event, then run OD and send its covariance to the selected event's primary object;
// the carrier switches to the Conjunction tab and the supplied-covariance summary appears.
test('OD covariance carries into the Conjunction supplied covariance', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Ingest the covariance-less OEM, screen it, and select the flagged event.
  await openAnalyze(page, 'conjunction');
  await expandCard(page, 'catalog-screen');
  await page.getByTestId('ingest-format').selectOption('oem');
  await page.getByTestId('ingest-sample').click();
  await page.getByTestId('ingest-run').click();
  await expect(page.getByTestId('ingest-summary')).toContainText('0 with covariance', { timeout: 20_000 });
  await page.getByTestId('screen-catalog').click();
  await expandCard(page, 'per-event-pc');
  await expect(page.getByTestId('conjunction-event-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('conjunction-event-0').click();
  await expect(page.getByTestId('pc-full')).toContainText('n/a', { timeout: 20_000 });

  // Run OD (Orbit & Maneuver tab), then send its covariance to the selected event's primary object.
  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'od');
  await page.getByTestId('run-od').click();
  await expect(page.getByTestId('od-result')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('od-to-conjunction')).toBeVisible();
  await page.getByTestId('od-to-conjunction').click();

  // The carrier switched to the Conjunction tab and recorded the supplied OD covariance.
  await expect(page.getByTestId('conjunction-panel')).toBeVisible({ timeout: 20_000 });
  await expandCard(page, 'per-event-pc');
  await expect(page.getByTestId('cov-supplied-summary')).toBeVisible({ timeout: 20_000 });
});

// Wave 2B carrier: a conjunction event seeds an avoidance Maneuver into the editable MCS via an
// explicit "Plan avoidance burn" action that switches to the Orbit & Maneuver tab with the burn
// populated. Ingest the CDM (carries covariance), screen, select the event, plan the burn, and read
// the extra Maneuver segment in the MCS builder.
test('a conjunction event seeds an avoidance burn into the MCS builder', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The default editable MCS has four segments (indices 0..3) before any carrier runs.
  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'mcs');
  await expect(page.getByTestId('mcs-segment-3')).toBeVisible();
  await expect(page.getByTestId('mcs-segment-4')).toHaveCount(0);

  // Ingest the CDM, screen, and select the flagged event.
  await openAnalyze(page, 'conjunction');
  await expandCard(page, 'catalog-screen');
  await page.getByTestId('ingest-sample').click();
  await page.getByTestId('ingest-run').click();
  await expect(page.getByTestId('ingest-summary')).toContainText('with covariance', { timeout: 20_000 });
  await page.getByTestId('screen-catalog').click();
  await expandCard(page, 'per-event-pc');
  await expect(page.getByTestId('conjunction-event-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('conjunction-event-0').click();
  await expect(page.getByTestId('pc-result')).toBeVisible({ timeout: 20_000 });

  // Plan the avoidance burn: it switches to Orbit & Maneuver and appends a Maneuver segment.
  await page.getByTestId('plan-avoidance-burn').click();
  await expect(page.getByTestId('orbit-maneuver-panel')).toBeVisible({ timeout: 20_000 });
  await expandCard(page, 'mcs');
  await expect(page.getByTestId('mcs-segment-4')).toBeVisible({ timeout: 20_000 });
});
