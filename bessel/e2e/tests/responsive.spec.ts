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

  // The backdrop dismisses the drawer. Click its visible region (right of the
  // drawer, which covers the left ~343px) so the tap is not intercepted by the rail.
  await page.getByTestId('drawer-backdrop').click({ position: { x: 380, y: 400 } });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('panel-drawer')).toHaveAttribute('aria-hidden', 'true');
});

test('the menu-heavy top-bar actions collapse behind a More menu on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Analyze stays inline; the menu-heavy actions move behind a single More popover.
  await expect(page.getByTestId('analyze-toggle')).toBeVisible();
  await expect(page.getByTestId('more-menu')).toBeVisible();
  await expect(page.getByTestId('mission-menu')).toHaveCount(0);

  // Opening More reveals the collapsed menus (Mission, Capture, Script, Views).
  await page.getByTestId('more-menu').click();
  await expect(page.getByTestId('mission-menu')).toBeVisible();
  await expect(page.getByTestId('script-menu')).toBeVisible();
  await expect(page.getByTestId('views-menu')).toBeVisible();
});

test('the desktop viewport keeps the side-by-side dock and flat top-bar menus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Strictly viewport-gated: neither the drawer nor the More menu appears on desktop.
  await expect(page.getByTestId('panels-drawer-toggle')).toHaveCount(0);
  await expect(page.getByTestId('more-menu')).toHaveCount(0);
  await expect(page.getByTestId('mission-menu')).toBeVisible();
  await expect(page.getByTestId('select-Saturn')).toBeVisible();
});
