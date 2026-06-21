import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze } from './sample.ts';

// The compare tray keeps analysis results as named snapshots and tabulates same-tool
// snapshots side by side for trade comparison, exportable as CSV.

test('keeping an access result surfaces it in the compare tray', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Compare is empty until a result is kept.
  await openAnalyze(page, 'compare');
  await expect(page.getByTestId('compare-empty')).toBeVisible();

  // Run access, keep it, and it appears in the compare tray as a tabulated snapshot.
  await openAnalyze(page, 'access');
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-fom')).toContainText('Coverage', { timeout: 20_000 });
  await page.getByTestId('keep-access').click();

  await openAnalyze(page, 'compare');
  await expect(page.getByTestId('compare-table')).toBeVisible();
  await expect(page.getByTestId('compare-table')).toContainText('coverage %');

  // Export and clear work.
  const download = page.waitForEvent('download');
  await page.getByTestId('compare-csv').click();
  expect((await download).suggestedFilename()).toContain('.csv');
  await page.getByTestId('compare-clear').click();
  await expect(page.getByTestId('compare-empty')).toBeVisible();
});
