import { test, expect } from '@playwright/test';

// The welcome card is the front door on every cold open: it offers the bundled mission
// or just exploring. Closing it hides it for the session but it returns on the next
// visit, unless the user ticks "don't show again", which persists through PAL Storage.

test('the welcome card reappears on reload unless the user opts out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('welcome-card')).toBeVisible();

  // Closing without opting out hides it for this session.
  await page.getByTestId('welcome-explore').click();
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);

  // It is back on the next load (a mere close does not suppress it).
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('welcome-card')).toBeVisible();

  // Ticking "don't show again" then closing persists the opt-out: it stays gone.
  await page.getByTestId('welcome-dont-show-again').check();
  await page.getByTestId('welcome-explore').click();
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
});

test('loading the sample mission from the welcome card loads it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('welcome-card')).toBeVisible();
  await expect(page.getByTestId('select-Cassini')).toHaveCount(0);

  await page.getByTestId('welcome-load-sample').click();
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
  await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 30_000 });
});
