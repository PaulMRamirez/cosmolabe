import { test, expect } from '@playwright/test';

// Phase D: selecting two objects measures the straight-line distance between them
// from their ephemerides.

test('measuring the distance between two selected objects', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await expect(page.getByTestId('measure-panel')).toContainText('Select two objects');

  await page.getByTestId('select-Saturn').click();
  await page.getByTestId('select-Earth').click();

  // Saturn to Earth is on the order of 10^9 km, so the AU value is shown too.
  await expect(page.getByTestId('measure-distance')).toContainText('km', { timeout: 5_000 });
  await expect(page.getByTestId('measure-distance')).toContainText('AU');
});
