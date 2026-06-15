import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// The Operations panel surfaces core capabilities in the shell: the telemetry
// adapter (a predicted-versus-actual residual) and the scripting API (a guided
// tour). No mission is bundled, so the missions list shows an empty state until
// the user loads a catalog.

test('operations panel: empty missions, telemetry residual, and guided tour', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // No bundled missions, and no telemetry until a spacecraft mission is loaded.
  await expect(page.getByTestId('panel-ops')).toContainText('none bundled');
  await expect(page.getByTestId('telemetry-residual')).toHaveText('Telemetry: none');

  // Load a mission (the sample), then telemetry publishes a residual.
  await loadCassiniSample(page);
  await expect(page.getByTestId('telemetry-residual')).toContainText('km', { timeout: 10_000 });

  // Scripting API: the guided tour starts playback (Play becomes Pause).
  await page.getByTestId('run-tour').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 5_000 });
});
