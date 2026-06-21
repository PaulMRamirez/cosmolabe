import { test, expect } from '@playwright/test';
import { loadCassiniSample } from './sample.ts';

// The Operations panel surfaces core capabilities in the shell: the telemetry
// adapter (a predicted-versus-actual residual) and the scripting API (a guided
// tour). A fixture mission plugin is bundled (the plugin registry, Track C), so
// the missions list shows it; telemetry stays empty until a mission is loaded.

test('operations panel: bundled plugin, telemetry residual, and guided tour', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Operations now live in the top-bar "Mission" menu. The bundled fixture plugin
  // appears in the missions list. The live telemetry residual is shown in the HUD ops
  // strip (not the menu), and only once a spacecraft mission is loaded.
  await page.getByTestId('mission-menu').click();
  await expect(page.getByTestId('mission-cassini-soi')).toBeVisible();
  await expect(page.getByTestId('hud-residual')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Load a mission (the sample), then the HUD ops strip publishes a residual.
  await loadCassiniSample(page);
  await expect(page.getByTestId('hud-residual')).toContainText('km', { timeout: 10_000 });

  // Scripting API: the guided tour starts playback (Play becomes Pause).
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('run-tour').click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 5_000 });
});
