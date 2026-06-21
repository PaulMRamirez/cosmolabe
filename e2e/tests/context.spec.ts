import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze } from './sample.ts';

// The shared analysis context bar at the top of the Analyze dock drives every tab by
// default: set the span and target once, and a tool run honors them without re-typing.
// A per-tool override reveals that tab's own inputs.

test('the shared context drives a tool by default, and the override reveals local inputs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  await openAnalyze(page, 'access');
  // The shared context bar is present and the Access tab uses it by default (its own
  // span/target inputs are hidden behind the override).
  await expect(page.getByTestId('analysis-context-bar')).toBeVisible();
  await expect(page.getByTestId('analysis-shared-indicator')).toBeVisible();
  await expect(page.getByTestId('param-span-days')).toHaveCount(0);

  // Set the span and target once in the shared bar.
  await page.getByTestId('ctx-span-days').fill('2');
  await page.getByTestId('ctx-target').selectOption('Saturn');
  await expect(page.getByTestId('analysis-shared-indicator')).toContainText('Saturn');

  // Running range from the Access tab honors the shared span/target (a polyline renders).
  await page.getByTestId('compute-range').click();
  await expect(page.getByTestId('range-chart').locator('polyline')).toHaveCount(1, {
    timeout: 20_000,
  });

  // Turning the override on reveals this tab's own inputs.
  await page.getByTestId('analysis-use-shared').uncheck();
  await expect(page.getByTestId('param-span-days')).toBeVisible();
  await expect(page.getByTestId('analysis-shared-indicator')).toHaveCount(0);
});
