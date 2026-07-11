import { test, expect } from '@playwright/test';
import { loadCassiniSample, openAnalyze, expandCard } from './sample.ts';

// The compare tray keeps analysis results as named snapshots and tabulates same-tool
// snapshots side by side for trade comparison, exportable as CSV. It lives in the
// Report & Compare tab inside the "Compare kept results" TaskCard.

test('keeping an access result surfaces it in the compare tray', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Compare is empty until a result is kept.
  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'compare');
  await expect(page.getByTestId('compare-empty')).toBeVisible();

  // Run access (Access & Comms tab), keep it, and it appears in the compare tray.
  await openAnalyze(page, 'access-comms');
  await expandCard(page, 'access');
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-fom')).toContainText('Coverage', { timeout: 20_000 });
  await page.getByTestId('keep-access').click();

  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'compare');
  await expect(page.getByTestId('compare-table')).toBeVisible();
  await expect(page.getByTestId('compare-table')).toContainText('coverage %');

  // Export and clear work.
  const download = page.waitForEvent('download');
  await page.getByTestId('compare-csv').click();
  expect((await download).suggestedFilename()).toContain('.csv');
  await page.getByTestId('compare-clear').click();
  await expect(page.getByTestId('compare-empty')).toBeVisible();
});

// Wave 2B generalized the snapshot model: ANY result block across the six domain panels is
// keepable, and the tray groups snapshots by domain side by side. This keeps two variants from
// DIFFERENT domains (a lighting beta-angle result and an access result) and asserts both grouped
// tables appear in the tray.
test('keeping two results from different domains shows both grouped in the compare tray', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Keep a lighting beta-angle result (Lighting & Geometry tab).
  await openAnalyze(page, 'lighting-geometry');
  await expandCard(page, 'beta');
  await page.getByTestId('compute-beta').click();
  await expect(page.getByTestId('beta-onset')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('keep-lighting-beta').click();

  // Keep an access result (Access & Comms tab).
  await openAnalyze(page, 'access-comms');
  await expandCard(page, 'access');
  await page.getByTestId('compute-access').click();
  await expect(page.getByTestId('access-fom')).toContainText('Coverage', { timeout: 20_000 });
  await page.getByTestId('keep-access').click();

  // The tray groups the two snapshots into per-domain tables.
  await openAnalyze(page, 'report-compare');
  await expandCard(page, 'compare');
  await expect(page.getByTestId('compare-domain-lighting')).toBeVisible();
  await expect(page.getByTestId('compare-domain-access')).toBeVisible();
  await expect(page.getByTestId('compare-domain-lighting')).toContainText('eclipse-onset');
  await expect(page.getByTestId('compare-domain-access')).toContainText('coverage %');
});
