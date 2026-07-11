import { test, expect } from '@playwright/test';

// Regression for the boot-vs-click race and the Unload path. The sample used to be
// loadable through several verbs (loadCatalog/loadCatalogUrl/loadSampleMission), and
// a click that landed before boot finished set the "loaded" label but silently
// skipped the scene build, leaving the neutral solar system (a ringless Saturn, no
// Cassini, no instrument) masquerading as a loaded mission. loadCatalog now awaits
// boot and commits the object list only after a successful build.

test('a sample load triggered before boot completes still builds the full mission', async ({
  page,
}) => {
  await page.goto('/');

  // Do NOT wait for status "Ready": open the always-mounted Mission menu and load the
  // sample immediately, so the load races an in-flight boot (the SPICE-WASM boot takes
  // long enough that this lands mid-boot). The Mission menu is not gated on ready.
  await page.getByTestId('mission-menu').click();
  await page
    .getByTestId('catalog-file-input')
    .setInputFiles('apps/web/public/samples/cassini-saturn.json');
  await page.keyboard.press('Escape');

  // With the fix, the object list and "loaded" label are set only after the scene is
  // rebuilt, so the Cassini row appearing means the full mission (rings, spacecraft,
  // instrument) actually built rather than the neutral scene being relabelled.
  await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 60_000 });

  // Unload returns to the neutral inner-solar-system scene: the Cassini row is gone
  // (the neutral object list is bodies-only) and the engine stays Ready.
  await page.getByTestId('mission-menu').click();
  await page.getByTestId('unload-catalog').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('select-Cassini')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('status')).toHaveText('Ready');
});
