// The MMGIS-shaped fixture host, observed live: the panel mounts only
// behind the bessel=1 flag, a host-authority product and an exploratory
// computed product share one surface with their provenance chips
// distinguishing them (the M-0011 side-by-side criterion), the deep link's
// startTime lands on the panel's cursor, cursor sync flows both directions
// (slider in, chart pick out to the chip and the URL), selection flows out,
// and focus flows in. This spec is the observed evidence behind the
// Session 8 Verified-by rows.

import { test, expect } from '@playwright/test';

test('mmgis fixture: flag gating', async ({ page }) => {
  await page.goto('/mmgis.html');
  await expect(page.getByTestId('mmgis-map')).toBeVisible();
  await expect(page.getByTestId('mmgis-map-layer')).toBeVisible();
  await expect(page.getByTestId('mmgis-no-panel')).toBeVisible();
  await expect(page.getByTestId('panel-surface')).toHaveCount(0);
});

test('mmgis fixture: host authority, cursor sync, deep links, selection, focus', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto(
    '/mmgis.html?bessel=1&mission=MSL&mapLon=137.4&mapLat=-4.6&mapZoom=10&startTime=2004-07-01T02:00:00.000Z',
  );
  await expect(page.getByTestId('mmgis-viewport')).toContainText('MSL at 137.4, -4.6');
  await expect(page.getByTestId('panel-surface')).toBeVisible();

  // The host product renders immediately with authority 'host' carried in
  // its provenance chip; the computed jobs land beside it as 'exploratory'.
  const hostCard = page.getByTestId('panel-host-product');
  await expect(hostCard).toBeVisible();
  const hostProv = hostCard.getByTestId('panel-provenance');
  await hostProv.locator('summary').click();
  await expect(hostProv).toContainText('Host data');
  await expect(hostProv).toContainText('mmgis:PathTool');
  await expect(hostProv).toContainText('host:a1b2c3d4');
  await expect(page.getByTestId('panel-track')).toBeVisible();

  await expect(page.getByTestId('panel-job-1')).toHaveAttribute('data-status', 'done', {
    timeout: 240_000,
  });
  const jobProv = page.getByTestId('panel-job-1').getByTestId('panel-provenance');
  await jobProv.locator('summary').click();
  await expect(jobProv).toContainText('Computed here');

  // Deep link in: startTime one hour past the epoch landed on the cursor,
  // drawn in the chart and echoed in the host chip.
  const chart = page.getByTestId('panel-chart-range-SATURN-to-CASSINI');
  await expect(chart).toBeVisible();
  await expect(page.getByTestId('panel-chart-range-SATURN-to-CASSINI-cursor')).toBeVisible();
  await expect(page.getByTestId('mmgis-cursor-chip')).toContainText('2004-07-01T02:00:00');

  // Host to panel: the slider moves the shared cursor.
  const slider = page.getByTestId('mmgis-time-slider');
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('mmgis-cursor-chip')).toContainText('2004-07-01T05:00:00');

  // Panel to host: a chart pick moves the slider, the chip, and the URL's
  // startTime (the deep-link out direction).
  await chart.click({ position: { x: 70, y: 40 } });
  const chipText = await page.getByTestId('mmgis-cursor-chip').textContent();
  expect(chipText).not.toContain('05:00:00');
  await expect
    .poll(() => page.url())
    .not.toContain('startTime=2004-07-01T02%3A00%3A00.000Z');
  expect(page.url()).toContain('startTime=2004-07-01T');
  expect(page.url()).toContain('bessel=1');
  expect(page.url()).toContain('mapZoom=10');

  // Panel to host: selecting the host product card reaches the host chip
  // with the authority stated.
  await page.getByTestId('panel-select-host-0').click();
  await expect(page.getByTestId('mmgis-selection-chip')).toContainText(
    'Traverse path (sol 3125) [host]',
  );

  // Host to panel: focus lands on the host card.
  await page.getByTestId('mmgis-focus-host').click();
  await expect(hostCard).toHaveAttribute('data-focused', 'true');
});
