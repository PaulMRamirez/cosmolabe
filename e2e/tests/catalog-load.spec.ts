import { test, expect } from '@playwright/test';

// Phase B: loading a catalog file (native or Cosmographia) makes the object
// browser catalog-driven, and an invalid file fails loudly with a located error.

test('loading a native catalog populates the object browser', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Boot is neutral: the inner solar system, no spacecraft (the Cassini demo is a
  // loadable sample, not baked in).
  await expect(page.getByTestId('select-Saturn')).toBeVisible();
  await expect(page.getByTestId('select-Cassini')).toHaveCount(0);

  // The catalog loader (and its load-error region) live in the top-bar "Mission"
  // menu; keep it open so the error live region stays mounted for the assertion.
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('catalog-file-input').setInputFiles('e2e/fixtures/sample-mission.json');

  await expect(page.getByTestId('select-Titan')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('select-Enceladus')).toBeVisible();
  await expect(page.getByTestId('load-error')).toHaveText('');
});

test('the one-click sample chip loads the bundled mission', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('select-Cassini')).toHaveCount(0);

  // The sample chip resolves its catalog URL under the deploy base path and loads it
  // through engine.loadCatalogUrl, so the spacecraft appears with no file picked.
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('load-sample-cassini-saturn.json').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });
});

test('an invalid catalog shows a loud, located error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  await page.getByTestId('mission-menu').click();
  await page.getByTestId('catalog-file-input').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not valid json'),
  });

  await expect(page.getByTestId('load-error')).not.toHaveText('');
  await expect(page.getByTestId('load-error')).toContainText('JSON');
});
