import { test, expect } from '@playwright/test';

// Phase D: saved views persist through the PAL storage and reconstruct the
// camera, like the shared-URL path.

test('saving, persisting, and applying a saved view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Frame Earth, then save it as a named view. Saved views live in the top-bar
  // "Views" menu.
  await page.getByTestId('center-Earth').click();
  await page.getByTestId('views-menu').click();
  await page.getByTestId('bookmark-name').fill('Earth view');
  await page.getByTestId('bookmark-save').click();
  await expect(page.getByRole('button', { name: 'Earth view', exact: true })).toBeVisible();

  // The view survives a reload (persisted via PAL storage).
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('views-menu').click();
  await expect(page.getByRole('button', { name: 'Earth view', exact: true })).toBeVisible();

  // Move elsewhere (the camera button closes the menu), then reopen and apply the
  // saved view to restore the Earth camera.
  await page.getByTestId('center-Saturn').click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-cam-target', 'Saturn');
  await page.getByTestId('views-menu').click();
  await page.getByRole('button', { name: 'Earth view', exact: true }).click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-cam-target', 'Earth');
});
