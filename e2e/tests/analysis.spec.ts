import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// The lighting analysis surfaces a real engine result in the UI: loading the
// Cassini sample, the Analysis menu computes the spacecraft eclipse and renders
// the umbra intervals as a Gantt timeline. (STK_PARITY_SPEC F5 / §4.9.)

test('lighting analysis computes and renders eclipse intervals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The Analysis menu is always visible; before a spacecraft is loaded it shows a
  // "load a spacecraft" notice and runs its tools on sample data.
  await expect(page.getByTestId('analysis-menu')).toBeVisible();
  await page.getByTestId('analysis-menu').click();
  await expect(page.getByTestId('analysis-empty-notice')).toBeVisible();
  await page.keyboard.press('Escape');

  await loadCassiniSample(page);
  await page.getByTestId('analysis-menu').click();
  await expect(page.getByTestId('analysis-empty-notice')).toHaveCount(0);
  await page.getByTestId('compute-eclipse').click();

  // The result (umbra Gantt) appears, with an interval count rendered.
  await expect(page.getByTestId('eclipse-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('interval-count')).toContainText('interval');

  // The range analysis plots the spacecraft-to-center-body distance as a
  // time-series polyline (the second charting primitive, batched spkpos path).
  await page.getByTestId('compute-range').click();
  await expect(page.getByTestId('range-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('range-chart').locator('polyline')).toHaveCount(1);

  // The access analysis finds line-of-sight visibility windows (spacecraft to the
  // Sun, occulted by the center body) through the geometry-finder + window algebra.
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-timeline')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('access-result').getByTestId('interval-count')).toContainText(
    'interval',
  );

  // The communications analysis plots the downlink Eb/N0 to Earth, combining the
  // geometric range with the link-budget physics (@bessel/rf).
  await page.getByTestId('compute-link').click();
  await expect(page.getByTestId('link-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-chart').locator('polyline')).toHaveCount(1);

  // The access run also reduces the window to a figure of merit (@bessel/coverage).
  await expect(page.getByTestId('access-fom')).toContainText('Coverage');

  // Conjunction: closest approach + collision probability (@bessel/conjunction).
  await page.getByTestId('compute-conjunction').click();
  await expect(page.getByTestId('conjunction-result')).toContainText('Pc');

  // Constellation design: a Walker pattern (@bessel/coverage), pure and synchronous.
  await page.getByTestId('compute-constellation').click();
  await expect(page.getByTestId('constellation-result')).toContainText('Walker');

  // Attitude: an eigen-axis slew profile plotted over time (@bessel/attitude).
  await page.getByTestId('compute-slew').click();
  await expect(page.getByTestId('slew-chart')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('slew-chart').locator('polyline')).toHaveCount(1);

  // Maneuver design: a Lambert transfer delta-v (@bessel/mission).
  await page.getByTestId('compute-transfer').click();
  await expect(page.getByTestId('transfer-result')).toContainText('delta-v');

  // 2D map: the sub-spacecraft ground track (@bessel/map-projection + GroundTrackMap).
  await page.getByTestId('compute-groundtrack').click();
  await expect(page.getByTestId('ground-track')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('ground-track').locator('polyline').first()).toBeVisible();

  // Interop: exporting the trajectory downloads a CCSDS OEM file (@bessel/interop).
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-oem').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.oem');
});

test('analysis tools honor user-supplied parameters (span, target, secondary)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);
  await page.getByTestId('analysis-menu').click();

  // The shared parameter form drives the span-based and target-based tools.
  await expect(page.getByTestId('analysis-params')).toBeVisible();
  await page.getByTestId('param-span-days').fill('2');
  await page.getByTestId('param-target').selectOption('Saturn');

  // Range over the 2-day span, to the chosen target, still renders a polyline.
  await page.getByTestId('compute-range').click();
  await expect(page.getByTestId('range-chart').locator('polyline')).toHaveCount(1, { timeout: 20_000 });

  // Conjunction against a user-chosen secondary object reports that object by name.
  await page.getByTestId('param-secondary').selectOption('Saturn');
  await page.getByTestId('compute-conjunction').click();
  await expect(page.getByTestId('conjunction-result')).toContainText('Saturn');
});
