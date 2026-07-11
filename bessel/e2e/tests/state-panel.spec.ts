import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loadCassiniSample } from './sample.ts';

// B20: the State panel shows the focused body's r/v vectors and osculating elements
// in a selectable SPICE frame. Loading the Cassini sample focuses Saturn; its state
// about the Sun resolves to finite numbers, the frame select switches the readout,
// and the panel stays AA-clean in both themes.

test('the State panel shows r/v and osculating elements and switches frame', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  // The State panel lives in the bottom-right inspector card with the focus selected.
  await expect(page.getByTestId('state-r')).toBeVisible({ timeout: 10_000 });

  // r and the semi-major axis resolve to finite values (Saturn about the Sun).
  await expect
    .poll(async () => (await page.getByTestId('state-r').textContent()) ?? '', { timeout: 10_000 })
    .toMatch(/\d/);
  await expect(page.getByTestId('state-a')).not.toHaveText('n/a');

  // Switching the frame recomputes (the select drives engine.setStateFrame).
  await page.getByTestId('state-frame-select').selectOption('ECLIPJ2000');
  await expect(page.getByTestId('state-frame-select')).toHaveValue('ECLIPJ2000');
  await expect
    .poll(async () => (await page.getByTestId('state-r').textContent()) ?? '', { timeout: 10_000 })
    .toMatch(/\d/);

  // AA-clean in dark and light: the panel uses theme-reactive selene tokens.
  const dark = await new AxeBuilder({ page }).include('[data-testid="inspector-card"]').analyze();
  expect(
    dark.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    JSON.stringify(dark.violations.map((v) => ({ id: v.id, impact: v.impact })), null, 2),
  ).toEqual([]);

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await new AxeBuilder({ page }).include('[data-testid="inspector-card"]').analyze();
  expect(
    light.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    JSON.stringify(light.violations.map((v) => ({ id: v.id, impact: v.impact })), null, 2),
  ).toEqual([]);
});

// The inspector card is dismissable: a single header close clears the selection and
// leaves Measure mode, so the user can declutter the canvas without hunting for a
// gated "Clear selection" inside the Measure section.
test('the inspector card has a header close that dismisses it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await loadCassiniSample(page);

  await expect(page.getByTestId('inspector-card')).toBeVisible({ timeout: 10_000 });
  const close = page.getByTestId('inspector-close');
  await expect(close).toHaveAttribute('aria-label', 'Close selection details');

  await close.click();
  await expect(page.getByTestId('inspector-card')).toHaveCount(0);
});
