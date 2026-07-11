import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { frameStats } from './frame-stats.ts';

// Texture-fidelity parity (Track A): loading a native catalog whose ring system
// declares an image texture must take the IMAGE ring path (not the procedural
// banded fallback). The viewport exposes data-ring-textured="true" once the
// scene is rebuilt, and the rebuilt frame is non-empty. The page passes the axe
// accessibility scan.

test('a ring system with an image texture renders the textured ring path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-ready', 'true');
  // The neutral scene's Saturn has no ring image, so the flag starts false.
  await expect(viewport).toHaveAttribute('data-ring-textured', 'false');

  // Load the textured-ring fixture through the Mission menu's catalog loader.
  await page.getByTestId('mission-menu').click();
  await page
    .getByTestId('catalog-file-input')
    .setInputFiles('e2e/fixtures/native-saturn-textured.json');

  await expect(page.getByTestId('select-Saturn')).toHaveText('Saturn', { timeout: 30_000 });
  await expect(page.getByTestId('load-error')).toHaveText('');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });

  // The image ring path was taken: the flag flips true.
  await expect(viewport).toHaveAttribute('data-ring-textured', 'true');

  await page.waitForTimeout(500);
  const after = await frameStats(viewport);
  expect(after.nonBackground).toBeGreaterThan(200);

  const a11y = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = a11y.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(seriousOrCritical).toEqual([]);
});
