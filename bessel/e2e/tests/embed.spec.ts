// The M-0007 embed smoke test, observed live: a bare host page (no workbench
// chrome) calls mount() with a HostDataAdapter, fallback compute stands up
// the worker substrate, and all four M-0004 product kinds materialize in
// their canonical panel forms with provenance chips. This spec is the
// observed evidence behind the Session 7 Verified-by for the panel.

import { test, expect } from '@playwright/test';

test('embed host: mount() materializes all four product kinds with provenance', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto('/embed.html');
  await expect(page.getByTestId('embed-host-title')).toHaveText('Bare embed host');
  await expect(page.getByTestId('panel-surface')).toBeVisible();

  // The four job cards render queued, then run sequentially to done. The
  // panel is generic: the kinds come from the host adapter's specs.
  for (let i = 0; i < 4; i++) {
    await expect(page.getByTestId(`panel-job-${i}`)).toHaveAttribute('data-status', 'done', {
      timeout: 240_000,
    });
  }

  // Intervals: one lane per target, bars for CASSINI, an honest empty SUN lane.
  await expect(page.getByTestId('panel-lane-CASSINI')).toBeVisible();
  await expect(page.getByTestId('panel-lane-SUN')).toBeVisible();

  // Series: the strip chart drew its polyline.
  await expect(page.getByTestId('panel-chart-range-SATURN-to-CASSINI')).toBeVisible();

  // Geometry: the 2D ground-track map drew the drape (no scene in the panel).
  await expect(page.getByTestId('panel-track')).toBeVisible();

  // Field: the flat heatmap resolved its cells, and streamed partials arrived
  // along the way (the materialization motion crosses the embed boundary).
  await expect(page.getByTestId('panel-field-map')).toBeVisible();
  const fieldPartials = Number(
    await page.getByTestId('panel-job-3').getAttribute('data-partials'),
  );
  expect(fieldPartials).toBeGreaterThanOrEqual(1);

  // Provenance: exploratory by construction (iron rule 4), the real kernel
  // set hash from the worker's frames tier behind the chip.
  const provenance = page.getByTestId('panel-job-0').getByTestId('panel-provenance');
  await provenance.locator('summary').click();
  await expect(provenance).toContainText('Computed here');
  await expect(provenance).toContainText('NONE');
});
