// The M-0008 grammar demo, observed live: jobs stream partials (the signature
// materialization motion), products render in their canonical forms, the
// provenance chip carries the compute worker's real kernel set hash, and
// cancellation from the tray control lands cooperatively. This spec is the
// observed evidence behind the Session 6 Verified-by and the M-0008
// ratification addendum.

import { test, expect } from '@playwright/test';

test('grammar demo: streamed partials, canonical forms, provenance, cancel', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByTestId('welcome-explore').click();
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('analyze-toggle').click();
  await page.getByTestId('tab-grammar').click();
  await expect(page.getByTestId('grammar-panel')).toBeVisible();

  // Series (GS-2): eight chunks stream, the strip chart materializes, and the
  // card ends done with the final pct.
  await page.getByTestId('grammar-run-gs2-series').click();
  const seriesCard = page.getByTestId('grammar-card-gs2-series');
  await expect(seriesCard).toHaveAttribute('data-status', 'done', { timeout: 180_000 });
  const seriesPartials = Number(await seriesCard.getAttribute('data-partials'));
  expect(seriesPartials).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('grammar-series-chart')).toBeVisible();

  // The kernel set hash chip is populated by the worker's frames layer, and
  // the provenance popover carries the same hash prefix: one provenance
  // source, visible in the grammar.
  const hashChip = page.getByTestId('grammar-kernel-hash');
  await expect(hashChip).toHaveText(/^[0-9a-f]{16}$/);
  const hashPrefix = (await hashChip.textContent())!;
  const provenance = seriesCard.getByTestId('grammar-provenance');
  await provenance.locator('summary').click();
  await expect(provenance).toContainText('series@0.0.0');
  await expect(provenance).toContainText(hashPrefix);
  await expect(provenance).toContainText('NONE');

  // Access lanes (GS-2): windows draw onto per-target lanes; the CASSINI lane
  // carries bars and the SUN lane is honestly empty.
  await page.getByTestId('grammar-run-gs2-access').click();
  await expect(page.getByTestId('grammar-card-gs2-access')).toHaveAttribute(
    'data-status',
    'done',
    { timeout: 180_000 },
  );
  await expect(page.getByTestId('grammar-lane-CASSINI')).toBeVisible();
  await expect(page.getByTestId('grammar-lane-SUN')).toBeVisible();

  // Ground track (GS-2): the drape lands in the scene and the chip reports it.
  await page.getByTestId('grammar-run-gs2-track').click();
  await expect(page.getByTestId('grammar-card-gs2-track')).toHaveAttribute(
    'data-status',
    'done',
    { timeout: 180_000 },
  );
  await expect(page.getByTestId('grammar-track-note')).toContainText('vertices');

  // Coverage field (GS-4, the Walker set): cancel from the tray control while
  // the sweep runs; the job ends cancelled, cooperatively. The cancel goes in
  // immediately after the run starts so the check cannot race a fast sweep.
  await page.getByTestId('grammar-run-gs4-field').click();
  const fieldCard = page.getByTestId('grammar-card-gs4-field');
  await expect(fieldCard).toHaveAttribute('data-status', 'running');
  await page.getByTestId('grammar-cancel-gs4-field').click();
  await expect(fieldCard).toHaveAttribute('data-status', 'cancelled', { timeout: 60_000 });

  // And a full field run resolves every cell into the heatmap drape.
  await page.getByTestId('grammar-run-gs4-field').click();
  await expect(fieldCard).toHaveAttribute('data-status', 'done', { timeout: 240_000 });
  await expect(page.getByTestId('grammar-field-note')).toContainText('288 of 288');

  // Walker site passes (GS-4 lanes, the W3 gate precision absorbed): one lane
  // per satellite of ground-site visibility windows.
  await page.getByTestId('grammar-run-gs4-access').click();
  await expect(page.getByTestId('grammar-card-gs4-access')).toHaveAttribute(
    'data-status',
    'done',
    { timeout: 180_000 },
  );
  await expect(page.getByTestId('grammar-lanes-gs4-access')).toBeVisible();
  await expect(page.getByTestId('grammar-lane--975000')).toBeVisible();

  // The porkchop inspector (M-0008 P1, the grid field domain of M-0004
  // amendment 1): the Earth to Mars delta-v surface streams column partials
  // and resolves into the flat heatmap with its finite-cell count and the
  // minimum delta-v caption.
  await page.getByTestId('grammar-run-porkchop').click();
  const porkchopCard = page.getByTestId('grammar-card-porkchop');
  await expect(porkchopCard).toHaveAttribute('data-status', 'done', { timeout: 240_000 });
  const porkchopPartials = Number(await porkchopCard.getAttribute('data-partials'));
  expect(porkchopPartials).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('grammar-porkchop-map')).toBeVisible();
  const finiteCells = Number(
    await page.getByTestId('grammar-porkchop-map').getAttribute('data-finite'),
  );
  expect(finiteCells).toBeGreaterThanOrEqual(80);
  await expect(page.getByTestId('grammar-porkchop-note')).toContainText('departure epoch');
  await expect(page.getByTestId('grammar-porkchop-note')).toContainText('km/s');
});
