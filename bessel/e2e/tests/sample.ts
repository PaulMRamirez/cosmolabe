import { expect, type Page } from '@playwright/test';

// The app boots into a neutral inner-solar-system scene with no bundled mission.
// This helper loads the Cassini-at-Saturn sample catalog (which ships as a file
// the user opens) through the catalog file input, and waits for the generic
// builder to rebuild the rich scene (spacecraft, FOV instrument, rings,
// atmosphere, orbits), focusing Saturn.
export async function loadCassiniSample(page: Page): Promise<void> {
  // The catalog loader lives in the top-bar "Mission" menu; open it to reach the
  // hidden file input, then close it so it does not sit over the scene.
  await page.getByTestId('mission-menu').click();
  await page
    .getByTestId('catalog-file-input')
    .setInputFiles('apps/web/public/samples/cassini-saturn.json');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('select-Cassini')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status')).toHaveText('Ready', { timeout: 30_000 });
  // Let the rebuilt scene settle (positions, instrument FOV) before assertions.
  await page.waitForTimeout(300);
}

// Expand the left-rail "Camera" panel (collapsed by default), where the view/frame/
// dolly/crane controls now live. Safe to call repeatedly (it stays open once opened).
export async function expandCamera(page: Page): Promise<void> {
  const toggle = page.getByTestId('panel-camera').getByRole('button', { name: 'Camera' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

// Open the consolidated Analyze dock to a given tab. The dock is a single toggle that
// does NOT auto-dismiss, so open it only when closed (a second toggle would close it),
// then select the tab (re-selecting an active tab is a safe no-op click).
export async function openAnalyze(page: Page, tab: string): Promise<void> {
  const dock = page.getByTestId('analyze-workbench');
  if (!(await dock.isVisible().catch(() => false))) {
    await page.getByTestId('analyze-toggle').click();
  }
  await page.getByTestId(`tab-${tab}`).click();
}

// In the re-slotted workbench each tool lives inside a collapsible TaskCard, and a
// collapsed card does not render its body. Expand the named card before interacting with
// its tool. Safe to call when already open: a TaskCard header toggle flips state, so this
// clicks only when the card is collapsed (its body region is hidden).
export async function expandCard(page: Page, id: string): Promise<void> {
  const toggle = page.getByTestId(`taskcard-${id}-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
