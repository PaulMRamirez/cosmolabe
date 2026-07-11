import { test, expect } from '@playwright/test';
import { frameStats } from './frame-stats.ts';

// Phase C (full fromCosmographia importer): loading a multi-item Cosmographia
// catalog through the file input turns every item (bodies, a spacecraft with a
// SPICE trajectory, a sensor, an observation) into a native catalog, makes the
// object browser catalog-driven, AND rebuilds the rendered 3D scene. The
// spacecraft uses a SPICE trajectory (target "-82", center Saturn "6") so it
// renders with the bundled Cassini-class kernels, proving the
// catalog-load -> renderMission path end to end.

test('importing a multi-item Cosmographia catalog rebuilds the rendered scene', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-ready', 'true');

  // The neutral inner-solar-system scene renders first.
  const before = await frameStats(viewport);
  expect(before.nonBackground).toBeGreaterThan(200);

  // The catalog loader (and its load-error region) live in the top-bar "Mission"
  // menu; keep it open so the error live region stays mounted for the assertion.
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('catalog-file-input').setInputFiles('e2e/fixtures/cosmographia-multi.json');

  // The importer classifies items and the generic builder rebuilds: the object
  // browser lists the imported bodies (Saturn, Jupiter) and the spacecraft
  // (Probe), keyed by display name so selection resolves against the rebuilt scene.
  await expect(page.getByTestId('select-Probe')).toHaveText('Probe', { timeout: 30_000 });
  await expect(page.getByTestId('select-Saturn')).toHaveText('Saturn');
  await expect(page.getByTestId('select-Jupiter')).toHaveText('Jupiter');
  await expect(page.getByTestId('load-error')).toHaveText('');

  // Status returns to Ready and the rebuilt scene still renders a non-empty frame.
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });
  await page.waitForTimeout(500);
  const after = await frameStats(viewport);
  expect(after.nonBackground).toBeGreaterThan(200);
});
