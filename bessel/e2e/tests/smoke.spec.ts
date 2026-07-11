import { test, expect } from '@playwright/test';

test('app shell renders the Bessel landmark and PWA manifest', async ({ page }) => {
  await page.goto('/');
  // Exact match: the first-run welcome card also has a heading containing "Bessel".
  await expect(page.getByRole('heading', { name: 'Bessel', exact: true })).toBeVisible();
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
});
