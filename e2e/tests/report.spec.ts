import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze } from './sample.ts';

// The data-provider workbench: pick a provider (range) and an observer/target pair,
// run one evalSeries job, and read the unit-tagged report table; export it as CSV.
// (STK_PARITY_SPEC §4.10.)

test('report workbench runs a provider and exports CSV', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  await openAnalyze(page, 'report');
  // Default provider is range; override the shared context to pick Cassini -> Saturn.
  await page.getByTestId('report-use-shared').uncheck();
  await page.getByTestId('report-observer').selectOption('Cassini');
  await page.getByTestId('report-target').selectOption('Saturn');
  await page.getByTestId('run-report').click();

  await expect(page.getByTestId('report-table')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('report-row-count')).toContainText('row');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('report-csv').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.csv');
});
