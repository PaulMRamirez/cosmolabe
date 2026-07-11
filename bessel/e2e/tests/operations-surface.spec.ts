import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// The live telemetry adapter publishes a predicted-versus-actual residual in the
// HUD ops strip (not a menu), and only once a spacecraft mission is loaded.

test('the HUD ops strip publishes a telemetry residual once a mission loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Nothing is loaded yet, so the residual is absent.
  await expect(page.getByTestId('hud-residual')).toHaveCount(0);

  // Load a mission (the sample), then the HUD ops strip publishes a residual.
  await loadCassiniSample(page);
  await expect(page.getByTestId('hud-residual')).toContainText('km', { timeout: 10_000 });
});
