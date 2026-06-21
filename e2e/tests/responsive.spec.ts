import { test, expect } from '@playwright/test';

// B23: on a narrow (phone) viewport the dock collapses to an off-canvas drawer so the
// viewport is unobstructed; a toggle slides the panels in and a backdrop dismisses
// them. The object browser (the left rail) lives in that drawer.

test('the panel rail collapses into a toggleable drawer on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // The drawer is closed at first: the toggle reads collapsed and the panel is hidden.
  const toggle = page.getByTestId('panels-drawer-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('panel-drawer')).toHaveAttribute('aria-hidden', 'true');

  // Opening the drawer reveals the object browser (the left rail content).
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('panel-drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByTestId('panel-drawer').getByTestId('select-Saturn')).toBeVisible();

  // The backdrop dismisses the drawer.
  await page.getByTestId('drawer-backdrop').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('panel-drawer')).toHaveAttribute('aria-hidden', 'true');
});

test('the desktop viewport keeps the side-by-side dock (no drawer toggle)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Strictly viewport-gated: the drawer affordance never appears on desktop.
  await expect(page.getByTestId('panels-drawer-toggle')).toHaveCount(0);
  await expect(page.getByTestId('select-Saturn')).toBeVisible();
});
