import { test, expect } from '@playwright/test';
import { openAnalyze, expandCard } from './sample.ts';

// The propagation workbench is mission-independent and reads a USER-SET spacecraft source
// (no hardcoded sample TLE): paste a TLE into the source control, set it, then run SGP4 and
// the numerical HPOP integrator from that source and compare their altitude. (STK_PARITY_SPEC
// §4.1; analysis-UX Phase 1.)

// A valid checksummed TLE (the SGP4-VER catalog-5 case), pasted as the source.
const TLE =
  '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753\n' +
  '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';

test('propagate a pasted TLE renders altitude series and ground track (SGP4 vs HPOP)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await openAnalyze(page, 'orbit-maneuver');
  await expandCard(page, 'propagate');

  // Before a source is set the SGP4 run is gated and a clear hint is shown (no sample fallback).
  await expect(page.getByTestId('propagate-no-source')).toBeVisible();
  await expect(page.getByTestId('propagate-tle')).toBeDisabled();

  // Set the spacecraft source by pasting a TLE into the source control.
  await page.getByTestId('sc-source-tle').click();
  await page.getByTestId('param-sc-source').fill(TLE);
  await page.getByTestId('sc-source-apply').click();
  await expect(page.getByTestId('sc-source-active')).toContainText('TLE 5');

  // SGP4 now runs from THAT source.
  await page.getByTestId('propagate-tle').click();
  await expect(page.getByTestId('tle-period')).toContainText('period', { timeout: 20_000 });
  await expect(page.getByTestId('tle-altitude-chart').locator('polyline')).toHaveCount(1);
  await expect(page.getByTestId('tle-ground-track').locator('polyline').first()).toBeVisible();

  // Composable access on the propagated SPK: elevation mask intersected with a range gate,
  // surfaced as visible-pass intervals and a figure of merit, exportable as CSV.
  await page.getByTestId('compute-station-access').click();
  await expect(page.getByTestId('station-access-fom')).toContainText('pass', { timeout: 40_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('station-access-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.csv');

  // Numerical propagation: the native Cowell HPOP integrates the same source state under a
  // selectable force model and overlays its altitude (the analytic-vs-numerical companion).
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
