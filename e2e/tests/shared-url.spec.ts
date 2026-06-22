import { test, expect } from '@playwright/test';

// Phase 2 acceptance (SPEC Section 9): loading a shared URL reconstructs the
// encoded epoch, camera, and selection. The fragment format is the ADR-0008
// view URL contract (v=1&t=...&cam=mode:target:dist,az,el&sel=...).

function fragment(): string {
  const t = encodeURIComponent('2004-07-15T00:00:00Z');
  return `v=1&t=${t}&cam=center:Jupiter:1200,0.5,0.3&sel=Cassini,Saturn`;
}

test('a shared URL reconstructs the epoch, camera, and selection', async ({ page }) => {
  await page.goto(`/#${fragment()}`);
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  const viewport = page.getByTestId('viewport');
  await expect(viewport).toHaveAttribute('data-cam-target', 'Jupiter');
  await expect(viewport).toHaveAttribute('data-selection', 'Cassini,Saturn');

  // The epoch label is updated from the clock on a short throttle.
  await expect
    .poll(async () => viewport.getAttribute('data-epoch'), { timeout: 10_000 })
    .toContain('2004-07-15');
});

test('the Share button writes the current view to the URL fragment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });
  await page.getByTestId('center-Earth').click();
  await page.getByTestId('share').click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain('cam=center:Earth');
});
