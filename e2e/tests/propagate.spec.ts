import { test, expect } from '@playwright/test';

// The propagation workbench is mission-independent: from a cold boot (no mission
// loaded) it parses the bundled TLE, runs SGP4, publishes an in-memory SPK Type-13
// about the Earth, and reads the arc back through the geometry pipeline as an
// altitude time series and a ground track. (STK_PARITY_SPEC §4.1.)

test('propagate sample TLE renders altitude series and ground track', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await page.getByTestId('propagate-menu').click();
  await page.getByTestId('propagate-tle').click();

  // The propagated orbit surfaces as a period readout, an altitude polyline, and a
  // ground-track polyline, all from the published SPK.
  await expect(page.getByTestId('tle-period')).toContainText('period', { timeout: 20_000 });
  // Cold boot has no spacecraft, so the run is labelled as sample data.
  await expect(page.getByTestId('sample-data-tag')).toBeVisible();
  await expect(page.getByTestId('tle-altitude-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByTestId('tle-ground-track').locator('polyline').first()).toBeVisible();

  // Composable access on the propagated SPK: elevation mask intersected with sunlit,
  // surfaced as visible-pass intervals and a figure of merit, exportable as CSV.
  await page.getByTestId('compute-station-access').click();
  await expect(page.getByTestId('station-access-fom')).toContainText('pass', { timeout: 40_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('station-access-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.csv');

  // Numerical propagation: the native Cowell HPOP integrates the same TLE state under a
  // selectable force model and plots its altitude (the analytic-vs-numerical companion).
  // The frame note (TEME -> J2000) is always shown next to the force-model picker.
  await expect(page.getByTestId('hpop-frame-note')).toContainText('TEME');
  await page.getByTestId('hpop-force-model').selectOption('point-mass');
  await page.getByTestId('propagate-hpop').click();
  await expect(page.getByTestId('hpop-altitude-chart').locator('polyline')).toHaveCount(1, {
    timeout: 20_000,
  });

  // Switching to a higher-fidelity model (NxN gravity + drag) re-runs the integrator and
  // re-renders the altitude, proving the force-model selection threads through.
  await page.getByTestId('hpop-force-model').selectOption('drag');
  await page.getByTestId('propagate-hpop').click();
  await expect(page.getByTestId('hpop-altitude-chart').locator('polyline')).toHaveCount(1, {
    timeout: 20_000,
  });
});
