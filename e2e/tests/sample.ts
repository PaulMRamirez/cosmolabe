import { expect, type Page } from '@playwright/test';

// The app boots into a neutral inner-solar-system scene with no bundled mission.
// This helper loads the Cassini-at-Saturn sample catalog (which ships as a file
// the user opens) through the catalog file input, and waits for the generic
// builder to rebuild the rich scene (spacecraft, FOV instrument, rings,
// atmosphere, orbits), focusing Saturn.
export async function loadCassiniSample(page: Page): Promise<void> {
  await page
    .getByTestId('catalog-file-input')
    .setInputFiles('apps/web/public/samples/cassini-saturn.json');
  await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });
  // Let the rebuilt scene settle (positions, instrument FOV) before assertions.
  await page.waitForTimeout(300);
}
