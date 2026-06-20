import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { frameStats } from './frame-stats.ts';

// Cosmographia add-on parity (Track C): the shell surfaces the @bessel/catalog
// PluginRegistry as a plugin loader. A registered fixture plugin appears as a row;
// loading it furnishes its declared kernels in dependency order, renders its native
// catalog (Saturn with rings plus the Cassini arc), and marks the plugin activated.
// The panel passes the accessibility scan.

test('the plugins panel loads a fixture plugin and renders its mission', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The plugin loader lives in the top-bar "Plugins" menu.
  await page.getByTestId('plugins-menu').click();
  const row = page.getByTestId('plugin-row-cassini-soi');
  await expect(row).toBeVisible();
  // Not yet activated: no badge.
  await expect(page.getByTestId('plugin-activated-cassini-soi')).toHaveCount(0);

  // The expandable detail shows the ordered kernels (the spiceKernels analog).
  await page.getByTestId('plugin-detail-cassini-soi').click();
  await expect(page.getByTestId('plugin-kernels-cassini-soi')).toContainText('cassini-soi.bsp');

  // Load: furnish kernels in dependency order, then render the catalog.
  await page.getByTestId('plugin-load-cassini-soi').click();
  await page.keyboard.press('Escape'); // close the popover so it does not cover the scene

  // The rendered mission focuses Saturn and produces a non-empty WebGL frame.
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });
  await expect.poll(async () => page.getByTestId('viewport').getAttribute('data-cam-target'), {
    timeout: 30_000,
  }).toBe('Saturn');
  await page.waitForTimeout(300);
  const stats = await frameStats(page.getByTestId('viewport'));
  expect(stats.nonBackground).toBeGreaterThan(0);

  // The activated badge appears once the plugin's catalog is loaded.
  await page.getByTestId('plugins-menu').click();
  await expect(page.getByTestId('plugin-activated-cassini-soi')).toBeVisible();

  // The plugin panel has no serious or critical accessibility violations.
  const results = await new AxeBuilder({ page }).include('[data-testid="plugins-panel"]').analyze();
  const seriousOrCritical = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    seriousOrCritical,
    JSON.stringify(
      seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      null,
      2,
    ),
  ).toEqual([]);

  // Unload returns to the neutral inner-solar-system scene.
  await page.getByTestId('plugin-unload').click();
  await expect(page.getByTestId('plugins-status')).toContainText('No mission loaded');
});
