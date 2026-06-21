import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// Phase D: selecting two objects measures the straight-line distance between them
// from their ephemerides, plus the range rate and the angular separation seen
// from the mission spacecraft.

test('measuring the distance between two selected objects', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  // Loading the sample focuses and selects Saturn, so one more selection (Earth)
  // forms the measured pair.
  await loadCassiniSample(page);

  await expect(page.getByTestId('measure-panel')).toContainText('Select two objects');

  await page.getByTestId('select-Earth').click();

  // Saturn to Earth is on the order of 10^9 km, so the AU value is shown too.
  await expect(page.getByTestId('measure-distance')).toContainText('km', { timeout: 5_000 });
  await expect(page.getByTestId('measure-distance')).toContainText('AU');
  // The range rate (km/s) and the angular separation from the spacecraft are shown.
  await expect(page.getByTestId('measure-speed')).toContainText('km/s');
  await expect(page.getByTestId('measure-angle')).toContainText('deg apart');
});

test('Measure mode and Clear selection are explicit affordances', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Entering Measure mode flips the toggle and switches the guidance copy.
  const toggle = page.getByTestId('measure-mode');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('measure-panel')).toContainText('click two objects');

  // Clear selection empties the measured pair; with nothing selected the Clear
  // control retires but the panel stays open because Measure mode is on.
  await expect(page.getByTestId('measure-clear')).toBeVisible();
  await page.getByTestId('measure-clear').click();
  await expect(page.getByTestId('measure-clear')).toHaveCount(0);
  await expect(page.getByTestId('measure-mode')).toHaveAttribute('aria-pressed', 'true');
});
