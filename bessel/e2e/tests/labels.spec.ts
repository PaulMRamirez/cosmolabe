import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// Phase C: bodies and the spacecraft carry name labels rendered as a DOM overlay
// that tracks them, and the Labels setting toggles the whole layer.

test('object labels render over the viewport and toggle off', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // Saturn is the focus and sits at the screen center, so its label is on screen.
  await expect(page.locator('.bessel-label', { hasText: 'Saturn' })).toBeVisible({
    timeout: 5_000,
  });

  // Visualization toggles live in the canvas "Layers" popover.
  await page.getByTestId('layers-popover').click();
  await page.getByTestId('setting-labels').uncheck();
  await expect(page.locator('.bessel-label-layer')).toBeHidden();

  await page.getByTestId('setting-labels').check();
  await expect(page.locator('.bessel-label-layer')).toBeVisible();
});
